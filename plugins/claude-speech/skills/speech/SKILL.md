---
name: speech
description: Toggle text-to-speech for Claude responses
---

# Speech Toggle

Control whether Claude's responses are spoken aloud using macOS text-to-speech.

## When to Use

When the user says things like:
- "turn on speech" / "turn off speech"
- "speak to me" / "stop speaking"
- "enable/disable voice"
- "I want to hear you" / "be quiet"

Also use this skill when:
- User installs the claude-speech plugin and needs hook setup
- User asks about setting up speech or voice output

## Commands

### Provider Commands

"use elevenlabs" / "switch to elevenlabs":
```bash
mkdir -p ~/.claude-speech && echo "provider=elevenlabs" > ~/.claude-speech/config
```

"use macos voice" / "use system voice":
```bash
mkdir -p ~/.claude-speech && echo "provider=macos" > ~/.claude-speech/config
```

"set elevenlabs voice to [name/id]":
```bash
echo "voice_id=VOICE_ID_HERE" >> ~/.claude-speech/config
```

Common voice IDs:
- Rachel (default): `21m00Tcm4TlvDq8ikWAM`
- Adam: `pNInz6obpgDQGcFmaJgB`
- Domi: `AZnzlk1XvdvUeBnXmlld`

### Enable Speech
```bash
touch ~/.claude-speak
```

### Disable Speech
```bash
rm -f ~/.claude-speak
```

### Check Status
```bash
[ -f ~/.claude-speak ] && echo "Speech is ON" || echo "Speech is OFF"
```

## Hook Setup (IMPORTANT)

The speech feature requires a Stop hook to be configured. When a user installs this plugin or asks about speech setup, help them add the hook.

### Check if hook is installed
Look in the project's `.claude/settings.json` for a Stop hook referencing `speak_response.sh`.

### Install the hook
Add this to `.claude/settings.json` (create the file if needed):

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/plugins/cache/markng-plugins/claude-speech/*/hooks/speak_response.sh"
          }
        ]
      }
    ]
  }
}
```

If the user already has hooks configured, merge the Stop hook into their existing configuration.

## Requirements

- macOS (uses `say` command)
- `jq` must be installed (`brew install jq`)

## How It Works

1. A Stop hook runs after each Claude response
2. If `~/.claude-speak` exists (or `CLAUDE_SPEAK=1` is set), the hook:
   - Reads the transcript file
   - Extracts the last assistant message
   - Speaks it using macOS `say` command (in background)

## Examples

User: "Turn on speech"
-> Run: `touch ~/.claude-speak`
-> Respond: "Speech is now enabled. You'll hear my responses spoken aloud."

User: "Turn off speech" / "Stop talking"
-> Run: `rm -f ~/.claude-speak`
-> Respond: "Speech disabled."

User: "I just installed the speech plugin"
-> Check if hook is configured in .claude/settings.json
-> If not, offer to add it
-> Verify jq is installed
-> Enable speech with `touch ~/.claude-speak`
