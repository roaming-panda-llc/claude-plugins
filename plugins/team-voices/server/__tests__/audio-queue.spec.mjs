import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createTeamVoicesServer } from '../lib.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

let tmpDir, ttsCalls, execCalls, unlinkCalls, instances;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tv-test-'));
  ttsCalls = [];
  execCalls = [];
  unlinkCalls = [];
  instances = [];
});

afterEach(async () => {
  for (const inst of instances) inst.cleanup();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function createServer(overrides = {}) {
  const inst = createTeamVoicesServer({
    generateTTS: async (text, voiceId, outputPath) => {
      ttsCalls.push({ text, voiceId, outputPath });
    },
    execAsync: async (cmd) => {
      execCalls.push(cmd);
    },
    fs: {
      mkdir: fs.mkdir,
      readFile: fs.readFile,
      readdir: fs.readdir,
      stat: fs.stat,
      writeFile: fs.writeFile,
      unlink: async (p) => {
        unlinkCalls.push(p);
      },
    },
    stateDir: tmpDir,
    ...overrides,
  });
  instances.push(inst);
  return inst;
}

async function connectClient(server) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

async function setMuted(instance, value) {
  const client = await connectClient(instance.server);
  await client.callTool({ name: 'team_voices_mute', arguments: { muted: value } });
  await client.close();
}

// Helper: wait for drain to finish processing all items
async function waitForDrain() {
  // drain is async and processes items one at a time via recursive calls.
  // Each drain cycle involves multiple awaits (generateTTS, execAsync, unlink).
  // Flushing microtasks repeatedly ensures all recursive drain calls complete.
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 0));
  }
}

describe('audio queue', () => {
  describe('enqueue', () => {
    it('adds item to queue and starts drain', async () => {
      const instance = createServer();
      instance.enqueue({ text: 'hello', voiceId: 'v1', from: 'agent' });

      // drain is called automatically and processes the item
      await waitForDrain();

      expect(ttsCalls).toHaveLength(1);
      expect(ttsCalls[0].text).toBe('hello');
      expect(ttsCalls[0].voiceId).toBe('v1');
      expect(execCalls).toHaveLength(1);
    });

    it('skips enqueue when muted (no bypassMute)', async () => {
      const instance = createServer();
      await setMuted(instance, true);

      instance.enqueue({ text: 'should not play', voiceId: 'v1', from: 'agent' });
      await waitForDrain();

      expect(ttsCalls).toHaveLength(0);
      expect(instance.getState().queue).toHaveLength(0);
    });

    it('enqueues when muted if bypassMute is true', async () => {
      const instance = createServer();
      await setMuted(instance, true);

      instance.enqueue({ text: 'bypass', voiceId: 'v1', from: 'agent', bypassMute: true });
      await waitForDrain();

      expect(ttsCalls).toHaveLength(1);
      expect(ttsCalls[0].text).toBe('bypass');
    });

    it('trims queue to 5 when exceeding 10 items', async () => {
      // Use a generateTTS that blocks forever so items accumulate in the queue
      let blockResolve;
      const blockPromise = new Promise(r => { blockResolve = r; });
      let firstCall = true;

      const instance = createServer({
        generateTTS: async (text, voiceId, outputPath) => {
          ttsCalls.push({ text, voiceId, outputPath });
          if (firstCall) {
            firstCall = false;
            await blockPromise; // Block on first item so rest pile up
          }
        },
      });

      // Enqueue first item - drain starts, shifts it off queue, blocks on generateTTS
      instance.enqueue({ text: 'item-0', voiceId: 'v1', from: 'agent' });
      await new Promise(r => setTimeout(r, 0)); // let drain start and shift

      // Now enqueue 11 more items while drain is blocked on item-0.
      // Items 1-10 accumulate (queue reaches length 10).
      // Item 11 triggers the trim: queue.length >= 10, splice to 5, then push = 6.
      for (let i = 1; i <= 11; i++) {
        instance.enqueue({ text: `item-${i}`, voiceId: 'v1', from: 'agent' });
      }

      const queue = instance.getState().queue;
      // After trim (splice keeps last 5) + push of item-11 = 6 items
      expect(queue.length).toBe(6);
      // The kept items should be the last 5 before trim (items 6-10) plus item-11
      expect(queue.map(q => q.text)).toEqual([
        'item-6', 'item-7', 'item-8', 'item-9', 'item-10', 'item-11',
      ]);

      // Unblock to clean up
      blockResolve();
      await waitForDrain();
    });
  });

  describe('drain', () => {
    it('processes items sequentially (not in parallel)', async () => {
      const callOrder = [];
      let callCount = 0;

      const instance = createServer({
        generateTTS: async (text) => {
          const myIndex = callCount++;
          callOrder.push({ event: 'tts-start', index: myIndex, text });
          await new Promise(r => setTimeout(r, 10));
          callOrder.push({ event: 'tts-end', index: myIndex, text });
        },
        execAsync: async (cmd) => {
          execCalls.push(cmd);
        },
      });

      instance.enqueue({ text: 'first', voiceId: 'v1', from: 'agent' });
      instance.enqueue({ text: 'second', voiceId: 'v2', from: 'agent' });

      // Wait long enough for both to process
      for (let i = 0; i < 50; i++) {
        await new Promise(r => setTimeout(r, 5));
      }

      // Verify sequential: first tts-end before second tts-start
      const firstEnd = callOrder.findIndex(e => e.event === 'tts-end' && e.text === 'first');
      const secondStart = callOrder.findIndex(e => e.event === 'tts-start' && e.text === 'second');
      expect(firstEnd).toBeLessThan(secondStart);
    });

    it('calls generateTTS with correct voiceId and text', async () => {
      const instance = createServer();
      instance.enqueue({ text: 'test speech', voiceId: 'voice-abc', from: 'agent' });
      await waitForDrain();

      expect(ttsCalls).toHaveLength(1);
      expect(ttsCalls[0].text).toBe('test speech');
      expect(ttsCalls[0].voiceId).toBe('voice-abc');
      expect(ttsCalls[0].outputPath).toMatch(/team-voice-.*\.mp3$/);
    });

    it('calls execAsync with afplay on darwin', async () => {
      const instance = createServer();
      instance.enqueue({ text: 'play me', voiceId: 'v1', from: 'agent' });
      await waitForDrain();

      expect(execCalls).toHaveLength(1);
      // On macOS (darwin), should use afplay
      if (process.platform === 'darwin') {
        expect(execCalls[0]).toMatch(/^afplay "/);
      } else {
        expect(execCalls[0]).toMatch(/^mpv /);
      }
    });

    it('cleans up temp file after playback', async () => {
      const instance = createServer();
      instance.enqueue({ text: 'cleanup test', voiceId: 'v1', from: 'agent' });
      await waitForDrain();

      expect(unlinkCalls).toHaveLength(1);
      expect(unlinkCalls[0]).toMatch(/team-voice-.*\.mp3$/);
    });

    it('continues to next item after TTS error', async () => {
      let callIndex = 0;
      const instance = createServer({
        generateTTS: async (text, voiceId, outputPath) => {
          callIndex++;
          if (callIndex === 1) throw new Error('TTS failed');
          ttsCalls.push({ text, voiceId, outputPath });
        },
      });

      instance.enqueue({ text: 'will-fail', voiceId: 'v1', from: 'agent' });
      instance.enqueue({ text: 'will-succeed', voiceId: 'v1', from: 'agent' });

      // Need longer wait since first item errors and then second processes
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 5));
      }

      // The second item should have been processed despite the first failing
      expect(ttsCalls).toHaveLength(1);
      expect(ttsCalls[0].text).toBe('will-succeed');
    });

    it('does nothing when queue is empty', async () => {
      const instance = createServer();

      // Calling drain directly on empty queue
      await instance.drain();
      await waitForDrain();

      expect(ttsCalls).toHaveLength(0);
      expect(execCalls).toHaveLength(0);
      expect(instance.getState().isPlaying).toBe(false);
    });

    it('does nothing when already playing', async () => {
      let blockResolve;
      const blockPromise = new Promise(r => { blockResolve = r; });

      const instance = createServer({
        generateTTS: async (text) => {
          ttsCalls.push({ text });
          if (text === 'blocking') await blockPromise;
        },
      });

      // Start first item that blocks
      instance.enqueue({ text: 'blocking', voiceId: 'v1', from: 'agent' });
      await new Promise(r => setTimeout(r, 5));

      expect(instance.getState().isPlaying).toBe(true);

      // Manually call drain - should return immediately since isPlaying is true
      await instance.drain();

      // Only one TTS call should have happened (the blocking one)
      expect(ttsCalls).toHaveLength(1);

      blockResolve();
      await waitForDrain();
    });
  });
});
