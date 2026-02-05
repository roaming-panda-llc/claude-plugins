---
triggers:
  - change voice
  - assign voice
  - mute voices
  - unmute voices
  - test voice
  - voice status
  - team voices
  - speaker
---

# Team Voices

Manage ElevenLabs text-to-speech voices for team collaboration. Each agent gets a distinct voice, and messages are played sequentially so agents never talk over each other.

The plugin automatically watches team inbox files and speaks new messages. You can also manage voices manually using these MCP tools.

## Available Tools

### Check Status
```tool
team_voices_status
```
Shows current voice assignments, queue length, mute state, and available voices.

### Assign a Voice
```tool
team_voices_assign
agent: researcher
voice: Rachel
```
Assign a specific voice to an agent. Available voices: Rachel, Josh, Antoni, Domi, Arnold, Adam, Elli, Sam, Bella. You can also pass a custom ElevenLabs voice ID.

### Test a Voice
```tool
team_voices_test
voice: Josh
```
Plays a test phrase with the specified voice.

### Speak Text Directly
```tool
speak
text: Hello team, the build is complete
voice: Rachel
```
Queue text for immediate TTS playback. Voice is optional (defaults to Rachel).

### Mute/Unmute
```tool
team_voices_mute
muted: true
```
Mute all voice output. Set `muted: false` to unmute. Test voice bypasses mute.

## Voice Pool

| Name | Style |
|------|-------|
| Rachel | Clear, professional |
| Josh | Friendly |
| Antoni | Professional |
| Domi | Professional |
| Arnold | Strong |
| Adam | Deep |
| Elli | Young |
| Sam | Narrator |
| Bella | Warm |

## How It Works

- Voices are auto-assigned round-robin to new team members
- Manual assignment overrides auto-assignment and persists across sessions
- Messages are queued and played one at a time (never overlapping)
- Idle notifications are automatically filtered out
- Broadcast messages are deduplicated (spoken only once)
- Protocol messages (task assignments, shutdown requests) are summarized before speaking

## Troubleshooting

- **No audio**: Check that `ELEVENLABS_API_KEY` is set in your environment
- **Queue backed up**: Use `team_voices_status` to check queue length
- **Wrong voice**: Use `team_voices_assign` to reassign
- **Too noisy**: Use `team_voices_mute` with `muted: true`
