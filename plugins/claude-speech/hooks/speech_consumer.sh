#!/bin/bash
# Speech queue consumer - processes queued messages in FIFO order
# This script should be run under lockf for exclusive access
#
# Usage: lockf -k ~/.claude-speech/consumer.lock speech_consumer.sh

set -e

SPEECH_DIR="$HOME/.claude-speech"
QUEUE_DIR="$SPEECH_DIR/queue"
PID_FILE="$SPEECH_DIR/consumer.pid"
IDLE_TIMEOUT=30
POLL_INTERVAL=1

# Write PID for status checking
echo $$ > "$PID_FILE"

# Clean up on exit
cleanup() {
    rm -f "$PID_FILE"
    exit 0
}
trap cleanup SIGTERM SIGINT EXIT

# Clean up stale .processing files older than 5 minutes
cleanup_stale_processing() {
    find "$QUEUE_DIR" -name "*.processing" -mmin +5 -delete 2>/dev/null || true
}

# Get the oldest message file in the queue
get_oldest_message() {
    ls -1 "$QUEUE_DIR"/*.msg 2>/dev/null | sort | head -1
}

# Check if speech is still enabled
is_speech_enabled() {
    [ -f "$HOME/.claude-speak" ] || [ "$CLAUDE_SPEAK" = "1" ]
}

# Main consumer loop
main() {
    cleanup_stale_processing

    idle_seconds=0

    while true; do
        # Check if speech is still enabled
        if ! is_speech_enabled; then
            # Speech disabled, exit cleanly
            exit 0
        fi

        # Find the oldest message
        msg_file=$(get_oldest_message)

        if [ -n "$msg_file" ] && [ -f "$msg_file" ]; then
            # Reset idle counter
            idle_seconds=0

            # Rename to .processing to mark as in-progress
            processing_file="${msg_file%.msg}.processing"
            if mv "$msg_file" "$processing_file" 2>/dev/null; then
                # Read the message content
                message=$(cat "$processing_file")

                # Speak the message (blocking)
                if [ -n "$message" ]; then
                    say "$message"
                fi

                # Delete the processed file
                rm -f "$processing_file"
            fi
        else
            # No messages, increment idle counter
            idle_seconds=$((idle_seconds + POLL_INTERVAL))

            if [ $idle_seconds -ge $IDLE_TIMEOUT ]; then
                # Idle timeout reached, exit
                exit 0
            fi

            sleep $POLL_INTERVAL
        fi
    done
}

main
