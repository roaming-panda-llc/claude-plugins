# Claude Speech Plugin

Text-to-speech for Claude Code responses using macOS `say` command.

## Features

- Toggle speech on/off via natural language ("turn on speech", "stop talking")
- Uses macOS built-in text-to-speech
- Non-blocking: speech runs in background

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

## Requirements

- macOS (uses `say` command)
- `jq` installed (`brew install jq`)

## License

MIT
