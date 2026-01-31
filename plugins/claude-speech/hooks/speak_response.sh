#!/bin/bash
# Queues Claude's response for speech using a file-based queue system
# Receives hook data via stdin
#
# Toggle: touch ~/.claude-speak to enable, rm ~/.claude-speak to disable
#
# Architecture:
#   This script (producer) -> writes to ~/.claude-speech/queue/
#   speech_consumer.sh (consumer) -> processes queue in FIFO order

# Check if speech is enabled (file exists or env var set)
if [ ! -f "$HOME/.claude-speak" ] && [ "$CLAUDE_SPEAK" != "1" ]; then
    exit 0
fi

# Setup directories
SPEECH_DIR="$HOME/.claude-speech"
QUEUE_DIR="$SPEECH_DIR/queue"
LOCK_FILE="$SPEECH_DIR/consumer.lock"
PID_FILE="$SPEECH_DIR/consumer.pid"
CONSUMER_SCRIPT="$(dirname "$0")/speech_consumer.sh"

mkdir -p "$QUEUE_DIR"

# Read the JSON input from stdin
input=$(cat)

# Log input for debugging
echo "$input" > /tmp/speak_hook_debug.json

# Extract the transcript path from the hook data
transcript_path=$(echo "$input" | jq -r '.transcript_path // empty')

if [ -z "$transcript_path" ] || [ ! -f "$transcript_path" ]; then
    echo "No transcript path found" >> /tmp/speak_hook_debug.log
    exit 0
fi

# Get the last assistant message from the JSONL transcript
# Each line is a JSON object, we want the last assistant message
# The content is an array of objects like {"type": "text", "text": "..."}, extract just the text
last_message=$(tail -20 "$transcript_path" | grep '"type":"assistant"' | tail -1 | jq -r '.message.content[] | select(.type == "text") | .text' 2>/dev/null | head -1)

# Log extracted message
echo "Extracted: $last_message" >> /tmp/speak_hook_debug.log

if [ -z "$last_message" ]; then
    exit 0
fi

# Clean the message for speech
clean_message="$last_message"

# Strip leading dashes to prevent option injection
clean_message="${clean_message#-}"

# Remove markdown links [text](url) -> "text, link to domain"
clean_message=$(echo "$clean_message" | sed -E 's|\[([^]]+)\]\(https?://([^/]+)[^)]*\)|\1, link to \2|g')

# Replace bare URLs with "link to domain"
clean_message=$(echo "$clean_message" | sed -E 's|https?://([^/ ]+)[^ ]*|link to \1|g')

# Replace file paths with "file path"
clean_message=$(echo "$clean_message" | sed -E 's|[~/][a-zA-Z0-9_./-]{10,}|file path|g')

# Clean up multiple spaces
clean_message=$(echo "$clean_message" | tr -s ' ')

# Global write lock - serializes queue writes to prevent race conditions
# Using mkdir for atomic lock acquisition
WRITE_LOCK="$QUEUE_DIR/.write_lock"

acquire_write_lock() {
    while ! mkdir "$WRITE_LOCK" 2>/dev/null; do
        sleep 0.01
    done
}

release_write_lock() {
    rmdir "$WRITE_LOCK" 2>/dev/null || true
}

# Write message to queue with global lock
acquire_write_lock

# Find next sequence number (safe now - we hold exclusive lock)
highest=$(ls -1 "$QUEUE_DIR" 2>/dev/null | grep -E '^[0-9]{4}_' | cut -d_ -f1 | sort -rn | head -1)
SEQ=$((10#${highest:-0} + 1))
SEQ=$(printf "%04d" $SEQ)
TIMESTAMP=$(date +%s)
MSG_FILE="$QUEUE_DIR/${SEQ}_${TIMESTAMP}.msg"

echo "$clean_message" > "$MSG_FILE"

release_write_lock

# Spawn consumer if not running
spawn_consumer_if_needed() {
    # Check if consumer is already running
    if [ -f "$PID_FILE" ]; then
        local pid
        pid=$(cat "$PID_FILE" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            # Consumer is running
            return 0
        fi
    fi

    # Spawn new consumer (lockf will ensure only one runs)
    nohup lockf -k "$LOCK_FILE" "$CONSUMER_SCRIPT" > /dev/null 2>&1 &
}

spawn_consumer_if_needed

exit 0
