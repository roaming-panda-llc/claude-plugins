# Claude Speech Plugin

Text-to-speech for Claude Code responses using macOS `say` command or ElevenLabs.

## Features

- Toggle speech on/off via natural language ("turn on speech", "stop talking")
- Multiple TTS providers: macOS built-in or ElevenLabs
- Queue-based architecture prevents overlapping speech
- Non-blocking: messages queue instantly, speech plays in order

## Installation

### Step 1: Add the marketplace and install the plugin

```
/plugin marketplace add markng/claude-plugins
/plugin install claude-speech@markng-plugins
```

### Step 2: Set up the hook (required)

After installing, tell Claude: **"I just installed the speech plugin, help me set it up"**

Claude will add the required Stop hook to your project's `.claude/settings.json`.

Or manually add this to `.claude/settings.json`:

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

### Step 3: Verify requirements

```bash
# Check jq is installed
which jq || brew install jq

# Check say is available (macOS only)
which say
```

## Usage

- **Enable speech:** Say "turn on speech" or run `touch ~/.claude-speak`
- **Disable speech:** Say "turn off speech" or run `rm ~/.claude-speak`

## ElevenLabs Setup (Optional)

For higher quality voices, you can use ElevenLabs instead of macOS `say`.

### 1. Set your API key

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export ELEVENLABS_API_KEY="your-api-key-here"
```

### 2. Switch to ElevenLabs

Tell Claude: "use elevenlabs" or run:

```bash
mkdir -p ~/.claude-speech && echo "provider=elevenlabs" > ~/.claude-speech/config
```

### 3. (Optional) Change voice

```bash
echo "voice_id=pNInz6obpgDQGcFmaJgB" >> ~/.claude-speech/config
```

### ElevenLabs Configuration

Config file: `~/.claude-speech/config` (simple key=value format)

```
provider=elevenlabs
voice_id=21m00Tcm4TlvDq8ikWAM
model_id=eleven_flash_v2_5
```

| Setting | Default | Description |
|---------|---------|-------------|
| `provider` | `macos` | TTS provider: `macos` or `elevenlabs` |
| `voice_id` | `21m00Tcm4TlvDq8ikWAM` | ElevenLabs voice ID (Rachel) |
| `model_id` | `eleven_flash_v2_5` | ElevenLabs model (~75ms latency) |

### Fallback Behavior

The plugin gracefully falls back to macOS `say` when:
- No config file exists
- `ELEVENLABS_API_KEY` environment variable is not set
- ElevenLabs API returns an error
- Unknown provider is configured

## Architecture

The plugin uses a file-based queue system to ensure messages are spoken in order without overlap:

```
Hook fires -> speak_response.sh (producer) -> writes to ~/.claude-speech/queue/
                                                      |
                                           speech_consumer.sh (consumer)
                                           - holds lockf exclusive lock
                                           - processes queue in FIFO order
                                           - runs `say` (blocking) for each message
                                           - exits after 30s idle
```

### Queue Structure

```
~/.claude-speech/
  queue/
    0001_1706700000.msg   # NNNN_timestamp.msg format
    0002_1706700001.msg
    ...
  consumer.lock           # lockf exclusive lock
  consumer.pid            # Running consumer PID
```

### Edge Cases

- **Consumer crash**: Lock released automatically; next message spawns new consumer
- **Speech disabled mid-queue**: Consumer checks flag each iteration, exits cleanly
- **Stale processing files**: Consumer cleans files older than 5 minutes on startup

## Requirements

- macOS (uses `say` command and `lockf` for synchronization)
- `jq` installed (`brew install jq`)

## License

MIT
