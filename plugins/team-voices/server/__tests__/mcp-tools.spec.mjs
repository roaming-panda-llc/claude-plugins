import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTeamVoicesServer, VOICE_POOL } from '../lib.mjs';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

let client, server, tmpDir, ttsCalls, instance;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tv-test-'));
  ttsCalls = [];

  instance = createTeamVoicesServer({
    generateTTS: async (text, voiceId, outputPath) => { ttsCalls.push({ text, voiceId, outputPath }); },
    execAsync: async () => {},
    stateDir: tmpDir,
  });
  server = instance.server;

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '1.0.0' }, {});

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterEach(async () => {
  // Let fire-and-forget saveConfig calls settle before closing
  await new Promise(r => setTimeout(r, 50));
  await client.close();
  instance.cleanup();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function parseResult(result) {
  return JSON.parse(result.content[0].text);
}

describe('MCP tools integration', () => {
  describe('tools/list', () => {
    it('returns all 5 tools with correct names', async () => {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(5);
      const names = tools.map(t => t.name).sort();
      expect(names).toEqual([
        'speak',
        'team_voices_assign',
        'team_voices_mute',
        'team_voices_status',
        'team_voices_test',
      ]);
    });

    it('each tool has inputSchema', async () => {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      }
    });
  });

  describe('speak', () => {
    it('queues text with default voice (Rachel)', async () => {
      const result = await client.callTool({ name: 'speak', arguments: { text: 'hello world' } });
      const parsed = parseResult(result);
      expect(parsed.queued).toBe(true);
      expect(parsed.voice).toBe('Rachel');
    });

    it('queues text with specified voice name', async () => {
      const result = await client.callTool({ name: 'speak', arguments: { text: 'hello', voice: 'Josh' } });
      const parsed = parseResult(result);
      expect(parsed.queued).toBe(true);
      expect(parsed.voice).toBe('Josh');
    });

    it('queues text with voice ID', async () => {
      const rachelId = VOICE_POOL[0].id;
      const result = await client.callTool({ name: 'speak', arguments: { text: 'hello', voice: rachelId } });
      const parsed = parseResult(result);
      expect(parsed.queued).toBe(true);
      expect(parsed.voice).toBe('Rachel');
    });

    it('returns queued:false when muted', async () => {
      await client.callTool({ name: 'team_voices_mute', arguments: { muted: true } });
      const result = await client.callTool({ name: 'speak', arguments: { text: 'hello' } });
      const parsed = parseResult(result);
      expect(parsed.queued).toBe(false);
      expect(parsed.reason).toBe('Muted');
    });

    it('returns queue position', async () => {
      const result = await client.callTool({ name: 'speak', arguments: { text: 'hello' } });
      const parsed = parseResult(result);
      expect(typeof parsed.position).toBe('number');
    });
  });

  describe('team_voices_status', () => {
    it('returns muted state', async () => {
      const result = await client.callTool({ name: 'team_voices_status', arguments: {} });
      const parsed = parseResult(result);
      expect(parsed.muted).toBe(false);
    });

    it('returns queue length', async () => {
      const result = await client.callTool({ name: 'team_voices_status', arguments: {} });
      const parsed = parseResult(result);
      expect(typeof parsed.queueLength).toBe('number');
    });

    it('returns voice assignments', async () => {
      await client.callTool({ name: 'team_voices_assign', arguments: { agent: 'alice', voice: 'Rachel' } });
      const result = await client.callTool({ name: 'team_voices_status', arguments: {} });
      const parsed = parseResult(result);
      expect(parsed.assignments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ agent: 'alice', voice: 'Rachel' }),
        ]),
      );
    });

    it('returns available voices list', async () => {
      const result = await client.callTool({ name: 'team_voices_status', arguments: {} });
      const parsed = parseResult(result);
      expect(parsed.availableVoices).toEqual(VOICE_POOL.map(v => v.name));
    });
  });

  describe('team_voices_assign', () => {
    it('assigns voice by name', async () => {
      const result = await client.callTool({ name: 'team_voices_assign', arguments: { agent: 'bob', voice: 'Arnold' } });
      const parsed = parseResult(result);
      expect(parsed.voice).toBe('Arnold');
    });

    it('returns assigned voice info', async () => {
      const result = await client.callTool({ name: 'team_voices_assign', arguments: { agent: 'carol', voice: 'Domi' } });
      const parsed = parseResult(result);
      expect(parsed.agent).toBe('carol');
      expect(parsed.voice).toBe('Domi');
      expect(parsed.voiceId).toBe(VOICE_POOL.find(v => v.name === 'Domi').id);
    });

    it('persists to config file', async () => {
      await client.callTool({ name: 'team_voices_assign', arguments: { agent: 'dave', voice: 'Sam' } });
      // saveConfig is fire-and-forget in manualAssignVoice, wait for it to settle
      await new Promise(r => setTimeout(r, 50));
      const configPath = path.join(tmpDir, 'config.json');
      const data = JSON.parse(await fs.readFile(configPath, 'utf-8'));
      expect(data.voiceAssignments.dave).toEqual(
        expect.objectContaining({ name: 'Sam' }),
      );
    });
  });

  describe('team_voices_mute', () => {
    it('sets muted to true', async () => {
      const result = await client.callTool({ name: 'team_voices_mute', arguments: { muted: true } });
      const parsed = parseResult(result);
      expect(parsed.muted).toBe(true);
    });

    it('sets muted to false', async () => {
      await client.callTool({ name: 'team_voices_mute', arguments: { muted: true } });
      const result = await client.callTool({ name: 'team_voices_mute', arguments: { muted: false } });
      const parsed = parseResult(result);
      expect(parsed.muted).toBe(false);
    });

    it('persists to config file', async () => {
      await client.callTool({ name: 'team_voices_mute', arguments: { muted: true } });
      const configPath = path.join(tmpDir, 'config.json');
      const data = JSON.parse(await fs.readFile(configPath, 'utf-8'));
      expect(data.muted).toBe(true);
    });
  });

  describe('team_voices_test', () => {
    it('queues test text with specified voice', async () => {
      const result = await client.callTool({ name: 'team_voices_test', arguments: { voice: 'Bella' } });
      const parsed = parseResult(result);
      expect(parsed.testing).toBe('Bella');
    });

    it('bypasses mute', async () => {
      await client.callTool({ name: 'team_voices_mute', arguments: { muted: true } });
      const result = await client.callTool({ name: 'team_voices_test', arguments: { voice: 'Rachel' } });
      const parsed = parseResult(result);
      expect(parsed.testing).toBe('Rachel');
      // Verify the TTS was actually called (not blocked by mute)
      // Wait briefly for async drain to invoke generateTTS
      await new Promise(r => setTimeout(r, 50));
      expect(ttsCalls.length).toBeGreaterThanOrEqual(1);
      expect(ttsCalls[ttsCalls.length - 1].text).toContain('Hello, I am Rachel');
    });

    it('uses correct test phrase format', async () => {
      await client.callTool({ name: 'team_voices_test', arguments: { voice: 'Josh' } });
      // Wait briefly for async drain
      await new Promise(r => setTimeout(r, 50));
      expect(ttsCalls.length).toBeGreaterThanOrEqual(1);
      expect(ttsCalls[ttsCalls.length - 1].text).toBe('Hello, I am Josh. Testing team voices.');
    });
  });
});
