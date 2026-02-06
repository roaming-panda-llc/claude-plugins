import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTeamVoicesServer } from '../lib.mjs';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

describe('socket-queue (UDS coordination)', () => {
  let tmpDir, teamsDir;
  const instances = [];

  function noopFsWatch() {
    return { on() { return this; }, close() {} };
  }

  function createInstance(overrides = {}) {
    const ttsCalls = [];
    const execCalls = [];
    const instance = createTeamVoicesServer({
      generateTTS: async (text, voiceId, outputPath) => {
        ttsCalls.push({ text, voiceId, outputPath });
      },
      execAsync: async (cmd) => {
        execCalls.push(cmd);
      },
      fsWatch: noopFsWatch,
      stateDir: tmpDir,
      teamsDir: overrides.teamsDir || teamsDir,
      ...overrides,
    });
    instances.push(instance);
    return { instance, ttsCalls, execCalls };
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tv-socket-'));
    teamsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tv-socket-teams-'));
  });

  afterEach(async () => {
    for (const inst of instances) {
      inst.cleanup();
    }
    instances.length = 0;
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(teamsDir, { recursive: true, force: true });
  });

  describe('leader election', () => {
    it('first instance becomes leader (socket file exists)', async () => {
      const { instance } = createInstance();
      await instance.startInboxWatcher();

      const socketPath = path.join(tmpDir, 'playback.sock');
      expect(existsSync(socketPath)).toBe(true);
    });

    it('second instance becomes follower (connects to existing socket)', async () => {
      const { instance: leader } = createInstance();
      await leader.startInboxWatcher();

      const { instance: follower } = createInstance();
      await follower.startInboxWatcher();

      // Both started without error; socket file still exists
      const socketPath = path.join(tmpDir, 'playback.sock');
      expect(existsSync(socketPath)).toBe(true);
    });
  });

  describe('follower enqueue routes to leader', () => {
    it('enqueue on follower triggers TTS on leader (not follower)', async () => {
      const { instance: leader, ttsCalls: leaderTTS } = createInstance();
      await leader.startInboxWatcher();

      const teamsDir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'tv-socket-teams2-'));
      const { instance: follower, ttsCalls: followerTTS } = createInstance({
        teamsDir: teamsDir2,
      });
      await follower.startInboxWatcher();

      // Enqueue on the follower
      follower.enqueue({ text: 'hello from follower', voiceId: 'test-voice' });

      // Wait for socket message to arrive and be processed
      await new Promise(r => setTimeout(r, 200));

      expect(leaderTTS.length).toBeGreaterThanOrEqual(1);
      expect(leaderTTS[0].text).toBe('hello from follower');
      expect(leaderTTS[0].voiceId).toBe('test-voice');
      expect(followerTTS).toHaveLength(0);

      // Cleanup the extra teamsDir
      await fs.rm(teamsDir2, { recursive: true, force: true });
    });
  });

  describe('stale socket recovery', () => {
    it('recovers from stale socket left by crashed process', async () => {
      const socketPath = path.join(tmpDir, 'playback.sock');

      // Spawn a child process that creates a UDS server, then SIGKILL it
      // to leave a stale socket file behind (normal close auto-unlinks)
      await new Promise((resolve, reject) => {
        const child = spawn('node', ['-e', `
          const net = require('net');
          const s = net.createServer();
          s.listen('${socketPath}', () => {
            process.stdout.write('ready');
          });
          setInterval(() => {}, 100000);
        `]);
        child.stdout.on('data', (d) => {
          if (d.toString().includes('ready')) {
            child.kill('SIGKILL');
          }
        });
        child.on('exit', () => {
          // Small delay to ensure OS has released the fd
          setTimeout(resolve, 50);
        });
        child.on('error', reject);
      });

      // Verify the stale socket file exists
      expect(existsSync(socketPath)).toBe(true);

      // New instance should detect ECONNREFUSED, unlink stale socket, become leader
      const { instance, ttsCalls } = createInstance();
      await instance.startInboxWatcher();

      // Verify it works as leader
      instance.enqueue({ text: 'recovered', voiceId: 'v1' });
      await new Promise(r => setTimeout(r, 100));

      expect(existsSync(socketPath)).toBe(true);
      expect(ttsCalls).toHaveLength(1);
      expect(ttsCalls[0].text).toBe('recovered');
    });
  });

  describe('concurrent stale-socket recovery', () => {
    it('two processes racing to recover stale socket — one leads, one follows', async () => {
      const socketPath = path.join(tmpDir, 'playback.sock');

      // Create a stale socket via SIGKILL'd child
      await new Promise((resolve, reject) => {
        const child = spawn('node', ['-e', `
          const net = require('net');
          const s = net.createServer();
          s.listen('${socketPath}', () => {
            process.stdout.write('ready');
          });
          setInterval(() => {}, 100000);
        `]);
        child.stdout.on('data', (d) => {
          if (d.toString().includes('ready')) {
            child.kill('SIGKILL');
          }
        });
        child.on('exit', () => setTimeout(resolve, 50));
        child.on('error', reject);
      });

      expect(existsSync(socketPath)).toBe(true);

      // Race two instances to recover the stale socket
      const { instance: a, ttsCalls: aTTS } = createInstance();
      const teamsDir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'tv-socket-teams2-'));
      const { instance: b, ttsCalls: bTTS } = createInstance({ teamsDir: teamsDir2 });

      // Both should resolve without crashing
      await Promise.all([
        a.startInboxWatcher(),
        b.startInboxWatcher(),
      ]);

      // Exactly one should be leader, one follower — verify by enqueueing from both
      a.enqueue({ text: 'from a', voiceId: 'v1' });
      b.enqueue({ text: 'from b', voiceId: 'v2' });

      await new Promise(r => setTimeout(r, 300));

      // All TTS should land on one instance (the leader)
      const totalTTS = aTTS.length + bTTS.length;
      expect(totalTTS).toBe(2);

      // The leader got both messages
      const leaderTTS = aTTS.length === 2 ? aTTS : bTTS;
      expect(leaderTTS).toHaveLength(2);

      await fs.rm(teamsDir2, { recursive: true, force: true });
    });
  });

  describe('leader cleanup allows new leader', () => {
    it('after leader cleanup, new instance becomes leader', async () => {
      const { instance: leader } = createInstance();
      await leader.startInboxWatcher();

      const socketPath = path.join(tmpDir, 'playback.sock');
      expect(existsSync(socketPath)).toBe(true);

      // Leader cleans up (removes socket)
      leader.cleanup();
      await new Promise(r => setTimeout(r, 50));

      // New instance should become leader
      const { instance: newLeader, ttsCalls } = createInstance();
      await newLeader.startInboxWatcher();

      expect(existsSync(socketPath)).toBe(true);

      // Verify it works as leader
      newLeader.enqueue({ text: 'new leader speaking', voiceId: 'v2' });
      await new Promise(r => setTimeout(r, 100));

      expect(ttsCalls).toHaveLength(1);
      expect(ttsCalls[0].text).toBe('new leader speaking');
    });
  });

  describe('drain without lock files', () => {
    it('processes items via TTS then exec without creating lock files', async () => {
      const { instance, ttsCalls, execCalls } = createInstance();

      instance.enqueue({ text: 'item one', voiceId: 'v1', from: 'agent' });
      instance.enqueue({ text: 'item two', voiceId: 'v2', from: 'agent' });

      // Wait for drain to process all items
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 10));
      }

      expect(ttsCalls).toHaveLength(2);
      expect(ttsCalls[0].text).toBe('item one');
      expect(ttsCalls[1].text).toBe('item two');
      expect(execCalls).toHaveLength(2);

      // Verify no lock files were created in stateDir
      const files = await fs.readdir(tmpDir);
      const lockFiles = files.filter(f => f.includes('lock') || f.endsWith('.lock'));
      expect(lockFiles).toHaveLength(0);
    });

    it('drain calls TTS then execAsync in correct order', async () => {
      const callOrder = [];
      const { instance } = createInstance({
        generateTTS: async (text) => {
          callOrder.push(`tts:${text}`);
        },
        execAsync: async () => {
          callOrder.push('exec');
        },
      });

      instance.enqueue({ text: 'hello', voiceId: 'v1', from: 'agent' });

      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 5));
      }

      expect(callOrder).toEqual(['tts:hello', 'exec']);
    });
  });
});
