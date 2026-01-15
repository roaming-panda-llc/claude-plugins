#!/bin/bash
# Speaks a summary of Claude's response using macOS say command
# Receives hook data via stdin
#
# Toggle: touch ~/.claude-speak to enable, rm ~/.claude-speak to disable

# Check if speech is enabled (file exists or env var set)
if [ ! -f "$HOME/.claude-speak" ] && [ "$CLAUDE_SPEAK" != "1" ]; then
    exit 0
fi

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

nohup say "$clean_message" >/dev/null 2>&1 &
disown

exit 0
