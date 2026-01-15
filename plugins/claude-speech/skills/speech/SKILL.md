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

## Commands

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

## How It Works

A Stop hook runs after each Claude response. If `~/.claude-speak` exists (or `CLAUDE_SPEAK=1` is set), the hook speaks the response using macOS `say` command.

## Examples

User: "Turn on speech"
-> Run: `touch ~/.claude-speak`
-> Respond: "Speech is now enabled. You'll hear my responses spoken aloud."

User: "Stop talking to me"
-> Run: `rm -f ~/.claude-speak`
-> Respond: "Speech disabled."
