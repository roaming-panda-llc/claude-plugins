# Narrated Demo Plugin

Generate narrated demo videos with synchronized audio using ElevenLabs TTS and Playwright browser automation.

## Features

- **Playwright-based browser automation** for reliable, repeatable demos
- **ElevenLabs TTS** with expressive audio tags for natural voiceover
- **Automatic audio/video synchronization** with precise timing
- **UI sounds** (clicks, keystrokes) for enhanced realism
- **Simple, intuitive API** that reads like a script

## Installation

### Step 1: Install the plugin

```
/plugin marketplace add markng/claude-plugins
/plugin install narrated-demo@markng-plugins
```

### Step 2: Install demos-not-memos

The plugin requires the demos-not-memos TypeScript library:

```bash
# Clone the repository
git clone https://github.com/markng/demos-not-memos.git
cd demos-not-memos

# Install dependencies (requires Node.js 18+)
npm install

# Install Playwright browser (if not already installed)
npx playwright install chromium
```

### Step 3: Install system dependencies

**ffmpeg** is required for audio/video processing:

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg

# Verify installation
ffmpeg -version
ffprobe -version
```

### Step 4: Configure ElevenLabs

Set your API key as an environment variable:

```bash
export ELEVENLABS_API_KEY="your-api-key-here"
```

Get an API key from [ElevenLabs](https://elevenlabs.io/).

## Usage

After installation, use the `/narrated-demo` skill in Claude Code. Claude will help you:

1. Create demo scripts with the TypeScript DSL
2. Configure voice, viewport, and output settings
3. Add expressive narration with audio tags
4. Run and iterate on your demos

### Example prompt

> "Create a narrated demo video of our landing page at localhost:3000. Show the hero section, scroll to features, and end with the signup form."

## Requirements

- **Node.js** 18.0.0 or higher
- **ffmpeg** and **ffprobe**
- **ElevenLabs API key**
- **macOS, Linux, or Windows** with GUI support (browser runs non-headless)

## License

MIT
