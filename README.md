# Claude Plugins Marketplace

Personal Claude Code plugin marketplace by Mark Sherwin Gonzales.

## Installation

Add this marketplace to Claude Code:

```
/plugin marketplace add markng/claude-plugins
```

## Available Plugins

| Plugin | Description |
|--------|-------------|
| `claude-speech` | Text-to-speech for Claude responses using macOS `say` command |

## Installing Plugins

After adding the marketplace:

```
/plugin install claude-speech@markng-plugins
```

## Plugin Details

### claude-speech

Speaks Claude's responses aloud using macOS text-to-speech.

**Features:**
- Toggle via natural language ("turn on speech", "stop talking")
- Non-blocking background speech
- Requires macOS and `jq`

**Usage:**
- Enable: `touch ~/.claude-speak` or say "turn on speech"
- Disable: `rm ~/.claude-speak` or say "turn off speech"

**Note:** The Stop hook must be manually added to your settings.json for full functionality. See plugin README for details.

## License

MIT
