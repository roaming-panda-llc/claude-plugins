import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ElevenLabsClient } from 'elevenlabs';
import { createWriteStream, watch as defaultFsWatch } from 'fs';
import { pipeline } from 'stream/promises';
import defaultFs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const defaultExecAsync = promisify(exec);

// --- Exported Constants ---

export const VOICE_POOL = [
  { name: 'Rachel', id: '21m00Tcm4TlvDq8ikWAM' },
  { name: 'Josh', id: 'TxGEqnHWrfWFTfGW9XjX' },
  { name: 'Antoni', id: 'ErXwobaYiN019PkySvjV' },
  { name: 'Domi', id: 'AZnzlk1XvdvUeBnXmlld' },
  { name: 'Arnold', id: 'VR6AewLTigWG4xSOukaG' },
  { name: 'Adam', id: 'pNInz6obpgDQGcFmaJgB' },
  { name: 'Elli', id: 'MF3mGyEYCl7XYWbV9V6O' },
  { name: 'Sam', id: 'yoZ06aMxZJJ28mfd3POQ' },
  { name: 'Bella', id: 'EXAVITQu4vr4xnSDxMaL' },
];

// --- Logging (must use stderr since stdout is MCP transport) ---

export function log(msg) {
  process.stderr.write(`[team-voices] ${msg}\n`);
}

// --- Pure Functions ---

export function shouldSpeak(msg) {
  if (!msg.text || msg.text.trim().length === 0) return false;
  if (isIdleNotification(msg.text)) return false;
  return true;
}

export function isIdleNotification(text) {
  if (!text.startsWith('{')) return false;
  try {
    return JSON.parse(text).type === 'idle_notification';
  } catch { return false; }
}

export function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')        // code blocks
    .replace(/`([^`]+)`/g, '$1')           // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/\*\*([^*]+)\*\*/g, '$1')     // bold
    .replace(/\*([^*]+)\*/g, '$1')         // italic
    .replace(/^#+\s+/gm, '')              // headings
    .replace(/\|[^\n]+\|/g, '')            // tables
    .replace(/^[-*]\s+/gm, '')            // list items
    .replace(/\n{2,}/g, '. ')
    .trim();
}

export function prepareProtocolText(parsed, from) {
  switch (parsed.type) {
    case 'task_assignment':
      return `${parsed.assignedBy || from} assigned task: ${parsed.subject || 'unknown'}`;
    case 'shutdown_request':
      return `${from} requests shutdown: ${parsed.reason || 'work complete'}`;
    case 'shutdown_approved':
      return `${from} has shut down`;
    case 'plan_approval_request':
      return `${from} submitted a plan for approval`;
    default:
      return `${from}: ${parsed.type.replace(/_/g, ' ')}`;
  }
}

export function prepareText(msg) {
  const from = msg.from || 'unknown';
  let text = msg.summary || msg.text;

  // Check if it's a protocol message (JSON with type field)
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.type) return prepareProtocolText(parsed, from);
    } catch { /* not JSON, treat as regular */ }
  }

  text = stripMarkdown(text);
  text = `${from} says: ${text}`;
  if (text.length > 500) text = text.substring(0, 497) + '...';
  return text;
}

export function isDuplicate(msg, seenHashes) {
  const hash = crypto.createHash('sha256')
    .update(`${msg.from || ''}${msg.text || ''}${msg.timestamp || ''}`)
    .digest('hex');
  if (seenHashes.has(hash)) return true;
  seenHashes.add(hash);
  if (seenHashes.size > 100) {
    const first = seenHashes.values().next().value;
    seenHashes.delete(first);
  }
  return false;
}

// --- Factory ---

export function createTeamVoicesServer(deps = {}) {
  const {
    generateTTS: injectedGenerateTTS,
    execAsync = defaultExecAsync,
    fs = defaultFs,
    fsWatch = defaultFsWatch,
    stateDir = path.join(os.homedir(), '.claude-team-voices'),
    teamsDir = path.join(os.homedir(), '.claude', 'teams'),
  } = deps;

  const configPath = path.join(stateDir, 'config.json');

  // Default TTS implementation
  let generateTTS;
  if (injectedGenerateTTS) {
    generateTTS = injectedGenerateTTS;
  } else {
    const client = new ElevenLabsClient();
    generateTTS = async (text, voiceId, outputPath) => {
      const audioStream = await client.textToSpeech.convert(voiceId, {
        text,
        model_id: 'eleven_flash_v2_5',
      });
      const writeStream = createWriteStream(outputPath);
      await pipeline(audioStream, writeStream);
    };
  }

  // --- State ---
  let voiceAssignments = new Map();
  let nextVoiceIndex = 0;
  let muted = false;
  const queue = [];
  let isPlaying = false;
  const seenHashes = new Set();
  const messageIndices = new Map();
  const watchers = new Map();
  const debounceTimers = new Map();
  let teamsWatcher = null;

  // --- Audio Queue ---

  function enqueue(item) {
    if (muted && !item.bypassMute) return;
    if (queue.length >= 10) queue.splice(0, queue.length - 5);
    queue.push(item);
    drain();
  }

  async function drain() {
    if (isPlaying || queue.length === 0) return;
    isPlaying = true;
    const item = queue.shift();
    try {
      const tmpFile = path.join(os.tmpdir(), `team-voice-${Date.now()}.mp3`);
      await generateTTS(item.text, item.voiceId, tmpFile);
      await execAsync(process.platform === 'darwin'
        ? `afplay "${tmpFile}"`
        : `mpv --no-video --really-quiet "${tmpFile}"`);
      await fs.unlink(tmpFile).catch(() => {});
    } catch (err) {
      log(`TTS error: ${err.message}`);
    }
    isPlaying = false;
    drain();
  }

  // --- Voice Assignment ---

  function assignVoice(agentName) {
    if (voiceAssignments.has(agentName)) return voiceAssignments.get(agentName);
    const voice = VOICE_POOL[nextVoiceIndex % VOICE_POOL.length];
    nextVoiceIndex++;
    voiceAssignments.set(agentName, voice);
    saveConfig();
    return voice;
  }

  function manualAssignVoice(agentName, voiceNameOrId) {
    const voice = VOICE_POOL.find(v =>
      v.name.toLowerCase() === voiceNameOrId.toLowerCase() || v.id === voiceNameOrId
    );
    if (voice) {
      voiceAssignments.set(agentName, voice);
    } else {
      voiceAssignments.set(agentName, { name: voiceNameOrId, id: voiceNameOrId });
    }
    saveConfig();
    return voiceAssignments.get(agentName);
  }

  function getVoiceForAgent(agentName) {
    return voiceAssignments.get(agentName) || assignVoice(agentName);
  }

  // --- Config Persistence ---

  async function loadConfig() {
    try {
      await fs.mkdir(stateDir, { recursive: true });
      const data = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(data);
      if (config.voiceAssignments) {
        voiceAssignments = new Map(Object.entries(config.voiceAssignments));
        nextVoiceIndex = config.nextVoiceIndex || voiceAssignments.size;
      }
      if (typeof config.muted === 'boolean') muted = config.muted;
    } catch { /* first run */ }
  }

  async function saveConfig() {
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      voiceAssignments: Object.fromEntries(voiceAssignments),
      nextVoiceIndex,
      muted,
    }, null, 2));
  }

  // --- Inbox Watcher ---

  async function processInboxFile(filePath, retries = 3) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const messages = JSON.parse(content);
      if (!Array.isArray(messages)) return;

      const lastIndex = messageIndices.get(filePath) || 0;
      if (messages.length <= lastIndex) return;

      const newMessages = messages.slice(lastIndex);
      messageIndices.set(filePath, messages.length);

      for (const msg of newMessages) {
        if (!shouldSpeak(msg)) continue;
        if (isDuplicate(msg, seenHashes)) continue;
        const text = prepareText(msg);
        const voice = getVoiceForAgent(msg.from || 'unknown');
        enqueue({ text, voiceId: voice.id, from: msg.from });
      }
    } catch (err) {
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 50));
        return processInboxFile(filePath, retries - 1);
      }
      log(`Failed to process inbox ${filePath}: ${err.message}`);
    }
  }

  function watchInboxFile(filePath) {
    if (watchers.has(filePath)) return;

    try {
      const watcher = fsWatch(filePath, () => {
        if (debounceTimers.has(filePath)) clearTimeout(debounceTimers.get(filePath));
        debounceTimers.set(filePath, setTimeout(() => processInboxFile(filePath), 100));
      });
      watcher.on('error', () => {
        log(`Watcher error for ${filePath}, cleaning up`);
        unwatchInboxFile(filePath);
      });
      watchers.set(filePath, watcher);
      processInboxFile(filePath); // initial read
    } catch (err) {
      log(`Cannot watch ${filePath}: ${err.message}`);
    }
  }

  function unwatchInboxFile(filePath) {
    const watcher = watchers.get(filePath);
    if (watcher) {
      watcher.close();
      watchers.delete(filePath);
    }
    debounceTimers.delete(filePath);
    messageIndices.delete(filePath);
  }

  async function scanTeamDir(teamDir) {
    try {
      const teamConfigPath = path.join(teamDir, 'config.json');
      const content = await fs.readFile(teamConfigPath, 'utf-8');
      const config = JSON.parse(content);
      if (!config.members || !Array.isArray(config.members)) return;

      for (const member of config.members) {
        const inboxPath = path.join(teamDir, 'inboxes', `${member.name}.json`);
        watchInboxFile(inboxPath);
      }

      // Also watch config.json for new members
      const configWatchKey = `${teamConfigPath}__config`;
      if (!watchers.has(configWatchKey)) {
        const watcher = fsWatch(teamConfigPath, () => {
          if (debounceTimers.has(configWatchKey)) clearTimeout(debounceTimers.get(configWatchKey));
          debounceTimers.set(configWatchKey, setTimeout(() => scanTeamDir(teamDir), 500));
        });
        watcher.on('error', () => {});
        watchers.set(configWatchKey, watcher);
      }
    } catch (err) {
      log(`Cannot scan team dir ${teamDir}: ${err.message}`);
    }
  }

  async function startInboxWatcher() {
    try {
      await fs.mkdir(teamsDir, { recursive: true });
      const entries = await fs.readdir(teamsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await scanTeamDir(path.join(teamsDir, entry.name));
        }
      }

      // Watch for new teams
      teamsWatcher = fsWatch(teamsDir, async (eventType, filename) => {
        if (filename) {
          const teamDir = path.join(teamsDir, filename);
          try {
            const stat = await fs.stat(teamDir);
            if (stat.isDirectory()) await scanTeamDir(teamDir);
          } catch { /* deleted */ }
        }
      });
      teamsWatcher.on('error', () => {});

      // Safety poll every 5 seconds
      setInterval(async () => {
        for (const [filePath] of messageIndices) {
          await processInboxFile(filePath);
        }
      }, 5000);

      log('Inbox watcher started');
    } catch (err) {
      log(`Failed to start inbox watcher: ${err.message}`);
    }
  }

  // --- MCP Server Setup ---

  const server = new Server(
    { name: 'team-voices', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'speak',
        description: 'Queue text for text-to-speech playback',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to speak' },
            voice: { type: 'string', description: 'Voice name or ElevenLabs voice ID (optional)' },
          },
          required: ['text'],
        },
      },
      {
        name: 'team_voices_status',
        description: 'Show current voice assignments, queue state, and mute status',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'team_voices_assign',
        description: 'Assign a specific voice to a team agent',
        inputSchema: {
          type: 'object',
          properties: {
            agent: { type: 'string', description: 'Agent name' },
            voice: { type: 'string', description: 'Voice name from pool or ElevenLabs voice ID' },
          },
          required: ['agent', 'voice'],
        },
      },
      {
        name: 'team_voices_mute',
        description: 'Mute or unmute all voice output',
        inputSchema: {
          type: 'object',
          properties: {
            muted: { type: 'boolean', description: 'True to mute, false to unmute' },
          },
          required: ['muted'],
        },
      },
      {
        name: 'team_voices_test',
        description: 'Test a voice with sample text',
        inputSchema: {
          type: 'object',
          properties: {
            voice: { type: 'string', description: 'Voice name from pool or ElevenLabs voice ID' },
          },
          required: ['voice'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'speak': {
        const voiceNameOrId = args.voice;
        let voice;
        if (voiceNameOrId) {
          voice = VOICE_POOL.find(v => v.name.toLowerCase() === voiceNameOrId.toLowerCase() || v.id === voiceNameOrId);
          if (!voice) voice = { name: voiceNameOrId, id: voiceNameOrId };
        } else {
          voice = VOICE_POOL[0];
        }
        if (muted) {
          return { content: [{ type: 'text', text: JSON.stringify({ queued: false, reason: 'Muted' }) }] };
        }
        enqueue({ text: args.text, voiceId: voice.id, from: 'direct' });
        return { content: [{ type: 'text', text: JSON.stringify({ queued: true, position: queue.length, voice: voice.name }) }] };
      }

      case 'team_voices_status': {
        const assignments = [];
        for (const [agent, voice] of voiceAssignments) {
          assignments.push({ agent, voice: voice.name, voiceId: voice.id });
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              muted,
              queueLength: queue.length,
              isPlaying,
              assignments,
              availableVoices: VOICE_POOL.map(v => v.name),
            }),
          }],
        };
      }

      case 'team_voices_assign': {
        const assigned = manualAssignVoice(args.agent, args.voice);
        return { content: [{ type: 'text', text: JSON.stringify({ agent: args.agent, voice: assigned.name, voiceId: assigned.id }) }] };
      }

      case 'team_voices_mute': {
        muted = args.muted;
        await saveConfig();
        return { content: [{ type: 'text', text: JSON.stringify({ muted }) }] };
      }

      case 'team_voices_test': {
        const voiceNameOrId = args.voice;
        let voice = VOICE_POOL.find(v => v.name.toLowerCase() === voiceNameOrId.toLowerCase() || v.id === voiceNameOrId);
        if (!voice) voice = { name: voiceNameOrId, id: voiceNameOrId };
        const testText = `Hello, I am ${voice.name}. Testing team voices.`;
        enqueue({ text: testText, voiceId: voice.id, from: 'test', bypassMute: true });
        return { content: [{ type: 'text', text: JSON.stringify({ testing: voice.name, position: queue.length }) }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  });

  // --- Public API ---

  function getState() {
    return { muted, queue, isPlaying, voiceAssignments, nextVoiceIndex, seenHashes, messageIndices, watchers };
  }

  return {
    server,
    enqueue,
    drain,
    assignVoice,
    manualAssignVoice,
    getVoiceForAgent,
    loadConfig,
    saveConfig,
    startInboxWatcher,
    getState,
  };
}
