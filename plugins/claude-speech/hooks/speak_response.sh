#!/bin/bash
# Queues Claude's response for speech using a file-based queue system
# Receives hook data via stdin
#
# Toggle: touch ~/.claude-speak to enable, rm ~/.claude-speak to disable
#
# Architecture:
#   This script (producer) -> writes to ~/.claude-speech/queue/
#   speech_consumer.sh (consumer) -> processes queue in FIFO order
#
# Position tracking:
#   Tracks last spoken line number per transcript to prevent double-speaking
#   when the hook fires multiple times (e.g., after text output, then after tool use)

# Check if speech is enabled (file exists or env var set)
if [ ! -f "$HOME/.claude-speak" ] && [ "$CLAUDE_SPEAK" != "1" ]; then
    exit 0
fi

# Setup directories
SPEECH_DIR="$HOME/.claude-speech"
QUEUE_DIR="$SPEECH_DIR/queue"
LOCK_FILE="$SPEECH_DIR/consumer.lock"
PID_FILE="$SPEECH_DIR/consumer.pid"
STATE_DIR="$SPEECH_DIR/state"
CONSUMER_SCRIPT="$(dirname "$0")/speech_consumer.sh"

mkdir -p "$QUEUE_DIR" "$STATE_DIR"

# Read the JSON input from stdin
input=$(cat)

# Extract the transcript path from the hook data
transcript_path=$(echo "$input" | jq -r '.transcript_path // empty')

if [ -z "$transcript_path" ] || [ ! -f "$transcript_path" ]; then
    exit 0
fi

# Generate a state file key from the transcript path (hash to avoid path issues)
state_key=$(echo "$transcript_path" | md5 -q)
STATE_FILE="$STATE_DIR/${state_key}.lastline"

# Per-transcript lock - prevents race condition where two hooks read state before either writes
# Claude Code fires the Stop hook twice simultaneously; this ensures only one processes
HOOK_LOCK="$STATE_DIR/${state_key}.lock"

while ! mkdir "$HOOK_LOCK" 2>/dev/null; do
    sleep 0.01
done

# Cleanup function to release lock on exit
cleanup() {
    rmdir "$HOOK_LOCK" 2>/dev/null || true
}
trap cleanup EXIT

# Get current line count of transcript
current_lines=$(wc -l < "$transcript_path" | tr -d ' ')

# Get last spoken line (0 if not set)
last_spoken_line=$(cat "$STATE_FILE" 2>/dev/null || echo "0")

# Calculate how many new lines to check
lines_to_check=$((current_lines - last_spoken_line))
if [ "$lines_to_check" -le 0 ]; then
    exit 0
fi

# Get the last assistant message with actual text content from NEW lines only
# Search backwards through assistant entries since the last one may only have tool_use/thinking blocks
# Note: Using tail -r for macOS compatibility (tac doesn't exist on macOS)
last_message=$(tail -"$lines_to_check" "$transcript_path" | grep '"type":"assistant"' | tail -r | while IFS= read -r line; do
    text=$(echo "$line" | jq -r '.message.content[] | select(.type == "text") | .text' 2>/dev/null | head -1)
    if [ -n "$text" ]; then
        echo "$text"
        break
    fi
done)

if [ -z "$last_message" ]; then
    exit 0
fi

# Update state BEFORE queuing to prevent race conditions
echo "$current_lines" > "$STATE_FILE"

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

# Find next sequence number and write to queue
highest=$(ls -1 "$QUEUE_DIR" 2>/dev/null | grep -E '^[0-9]{4}_' | cut -d_ -f1 | sort -rn | head -1)
SEQ=$((10#${highest:-0} + 1))
SEQ=$(printf "%04d" $SEQ)
TIMESTAMP=$(date +%s)
MSG_FILE="$QUEUE_DIR/${SEQ}_${TIMESTAMP}.msg"

echo "$clean_message" > "$MSG_FILE"

# Spawn consumer if not running
if [ -f "$PID_FILE" ]; then
    pid=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        # Consumer is running
        exit 0
    fi
fi

# Spawn new consumer (lockf will ensure only one runs)
nohup lockf -k "$LOCK_FILE" "$CONSUMER_SCRIPT" > /dev/null 2>&1 &

exit 0
