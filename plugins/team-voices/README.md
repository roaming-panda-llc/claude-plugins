# team-voices

ElevenLabs TTS for Claude Code team collaboration. Each agent on a team gets a distinct voice, so you can hear who is speaking.

## Prerequisites

- Node.js (v18+)
- ElevenLabs API key ([get one here](https://elevenlabs.io))

## Setup

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "team-voices": {
      "command": "node",
      "args": ["~/.claude/plugins/marketplaces/markng-plugins/plugins/team-voices/server/index.mjs"],
      "env": { "ELEVENLABS_API_KEY": "${ELEVENLABS_API_KEY}" }
    }
  }
}
```

Then install dependencies:

```bash
cd ~/.claude/plugins/marketplaces/markng-plugins/plugins/team-voices/server
npm install
```

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `speak` | Speak text using an agent's assigned voice |
| `team_voices_status` | Show current voice assignments for the team |
| `team_voices_assign` | Manually assign a specific voice to an agent |
| `team_voices_mute` | Mute/unmute voice output |
| `team_voices_test` | Test a voice by playing a sample phrase |

## Voice Pool

| Name | ID | Style |
|------|-----|-------|
| Rachel | 21m00Tcm4TlvDq8ikWAM | Clear, professional |
| Josh | TxGEqnHWrfWFTfGW9XjX | Friendly |
| Antoni | ErXwobaYiN019PkySvjV | Professional |
| Domi | AZnzlk1XvdvUeBnXmlld | Professional |
| Arnold | VR6AewLTigWG4xSOukaG | Strong |
| Adam | pNInz6obpgDQGcFmaJgB | Deep |
| Elli | MF3mGyEYCl7XYWbV9V6O | Young |
| Sam | yoZ06aMxZJJ28mfd3POQ | Narrator |
| Bella | EXAVITQu4vr4xnSDxMaL | Warm |

## How It Works

1. The MCP server watches team inbox files for incoming messages
2. When a new agent joins the team, it is auto-assigned a voice from the pool using round-robin allocation
3. TTS audio is played sequentially to avoid overlapping speech
4. Voice assignments and state are stored in `~/.claude-team-voices/`

## Troubleshooting

- **No audio output**: Ensure your `ELEVENLABS_API_KEY` environment variable is set and valid.
- **"Voice not found" errors**: Check that the voice IDs in the pool haven't been removed from your ElevenLabs account.
- **Overlapping audio**: The server queues speech sequentially. If audio overlaps, check that only one instance of the MCP server is running.
- **State issues**: Delete `~/.claude-team-voices/` to reset all voice assignments and start fresh.
- **Dependencies not found**: Run `npm install` in the `server/` directory.
