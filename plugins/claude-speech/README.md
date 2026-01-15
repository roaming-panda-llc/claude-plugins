# Claude Speech Plugin

Text-to-speech for Claude Code responses using macOS `say` command.

## Features

- Toggle speech on/off via natural language ("turn on speech", "stop talking")
- Uses macOS built-in text-to-speech
- Non-blocking: speech runs in background

## Installation

### Via Marketplace (if published)

```bash
/plugin install claude-speech@markng-plugins
```

### Manual Installation

1. Copy the hook script to a permanent location:
   ```bash
   cp hooks/speak_response.sh ~/.claude/speech/speak_response.sh
   chmod +x ~/.claude/speech/speak_response.sh
   ```

2. Add the hook to your `.claude/settings.json`:
   ```json
   {
     "hooks": {
       "Stop": [
         {
           "matcher": "",
           "hooks": [
             {
               "type": "command",
               "command": "~/.claude/speech/speak_response.sh"
             }
           ]
         }
       ]
     }
   }
   ```

3. Install the skill by adding to settings:
   ```json
   {
     "enabledPlugins": {
       "claude-speech@markng-plugins": true
     }
   }
   ```

## Usage

- **Enable speech:** Say "turn on speech" or run `touch ~/.claude-speak`
- **Disable speech:** Say "turn off speech" or run `rm ~/.claude-speak`

## Requirements

- macOS (uses `say` command)
- `jq` installed (`brew install jq`)

## License

MIT
