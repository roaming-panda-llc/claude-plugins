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

# Config reader - get value from config file or return default
get_config() {
    local key="$1" default="$2"
    grep "^${key}=" "$SPEECH_DIR/config" 2>/dev/null | cut -d'=' -f2 || echo "$default"
}

# ElevenLabs TTS via curl
speak_elevenlabs() {
    local msg="$1"
    local voice_id=$(get_config voice_id "21m00Tcm4TlvDq8ikWAM")
    local model_id=$(get_config model_id "eleven_flash_v2_5")

    # Fallback to macOS say if no API key
    [ -z "$ELEVENLABS_API_KEY" ] && { say "$msg"; return; }

    local audio=$(mktemp /tmp/claude-speech-XXXXXX.mp3)
    if curl -s -X POST "https://api.elevenlabs.io/v1/text-to-speech/${voice_id}" \
        -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "$(jq -n --arg t "$msg" --arg m "$model_id" '{text:$t,model_id:$m}')" \
        -o "$audio" && [ -s "$audio" ]; then
        afplay "$audio"
    else
        # Fallback to macOS say on API error
        say "$msg"
    fi
    rm -f "$audio"
}

# Provider dispatch - route to appropriate TTS backend
speak_message() {
    local msg="$1"
    case "$(get_config provider macos)" in
        elevenlabs) speak_elevenlabs "$msg" ;;
        *) say "$msg" ;;
    esac
}

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
                    speak_message "$message"
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
