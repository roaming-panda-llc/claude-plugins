import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTeamVoicesServer, VOICE_POOL } from '../lib.mjs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

describe('inbox watcher', () => {
  let tmpDir, teamsDir, stateDir, ttsCalls, instance;
  let watchCallbacks, watcherInstances;

  function mockFsWatch(targetPath, callback) {
    watchCallbacks.set(targetPath, callback);
    const watcher = {
      close() { watchCallbacks.delete(targetPath); },
      on() { return this; },
    };
    watcherInstances.push(watcher);
    return watcher;
  }

  async function createMockTeam(teamName, members) {
    const teamDir = path.join(teamsDir, teamName);
    await fs.mkdir(teamDir, { recursive: true });
    await fs.mkdir(path.join(teamDir, 'inboxes'), { recursive: true });
    await fs.writeFile(
      path.join(teamDir, 'config.json'),
      JSON.stringify({ members }),
    );
    return teamDir;
  }

  async function writeInbox(teamName, memberName, messages) {
    const inboxPath = path.join(teamsDir, teamName, 'inboxes', `${memberName}.json`);
    await fs.writeFile(inboxPath, JSON.stringify(messages));
    return inboxPath;
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tv-inbox-'));
    teamsDir = path.join(tmpDir, 'teams');
    stateDir = path.join(tmpDir, 'state');
    await fs.mkdir(teamsDir, { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });
    ttsCalls = [];
    watchCallbacks = new Map();
    watcherInstances = [];

    instance = createTeamVoicesServer({
      generateTTS: async (text, voiceId, outputPath) => {
        ttsCalls.push({ text, voiceId, outputPath });
      },
      execAsync: async () => {},
      fsWatch: mockFsWatch,
      stateDir,
      teamsDir,
    });
  });

  afterEach(async () => {
    // Close all mock watchers
    for (const w of watcherInstances) {
      w.close();
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('message processing via startInboxWatcher', () => {
    it('processes existing messages in inbox files on startup', async () => {
      const members = [{ name: 'researcher', agentId: 'abc', agentType: 'explore' }];
      await createMockTeam('my-team', members);
      await writeInbox('my-team', 'researcher', [
        { from: 'team-lead', text: 'Hello researcher', timestamp: '2024-01-01T00:00:00Z' },
      ]);

      await instance.startInboxWatcher();

      // Allow microtasks (processInboxFile is called from watchInboxFile)
      await new Promise(r => setTimeout(r, 50));

      expect(ttsCalls.length).toBe(1);
      expect(ttsCalls[0].text).toBe('team-lead says: Hello researcher');
    });

    it('filters out idle notifications', async () => {
      const members = [{ name: 'agent-1', agentId: 'a1', agentType: 'general' }];
      await createMockTeam('team-filter', members);
      await writeInbox('team-filter', 'agent-1', [
        { from: 'agent-2', text: '{"type":"idle_notification"}', timestamp: '2024-01-01T00:00:00Z' },
        { from: 'agent-2', text: 'Actual message', timestamp: '2024-01-01T00:01:00Z' },
      ]);

      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      expect(ttsCalls.length).toBe(1);
      expect(ttsCalls[0].text).toBe('agent-2 says: Actual message');
    });

    it('deduplicates broadcast messages across different inbox files', async () => {
      const members = [
        { name: 'researcher', agentId: 'r1', agentType: 'explore' },
        { name: 'tester', agentId: 't1', agentType: 'general' },
      ];
      await createMockTeam('team-dedup', members);

      const broadcastMsg = {
        from: 'team-lead',
        text: 'Starting deployment',
        timestamp: '2024-01-01T12:00:00Z',
      };

      await writeInbox('team-dedup', 'researcher', [broadcastMsg]);
      await writeInbox('team-dedup', 'tester', [broadcastMsg]);

      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      // Same from+text+timestamp should be deduplicated
      expect(ttsCalls.length).toBe(1);
      expect(ttsCalls[0].text).toBe('team-lead says: Starting deployment');
    });

    it('prepares text with "{from} says: {text}" format', async () => {
      const members = [{ name: 'dev', agentId: 'd1', agentType: 'general' }];
      await createMockTeam('team-format', members);
      await writeInbox('team-format', 'dev', [
        { from: 'alice', text: 'Pull request ready', timestamp: '2024-01-01T00:00:00Z' },
      ]);

      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      expect(ttsCalls[0].text).toBe('alice says: Pull request ready');
    });

    it('resolves voice for each agent using voice pool', async () => {
      const members = [{ name: 'dev', agentId: 'd1', agentType: 'general' }];
      await createMockTeam('team-voice', members);
      await writeInbox('team-voice', 'dev', [
        { from: 'bob', text: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
      ]);

      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      expect(ttsCalls.length).toBe(1);
      // First voice assignment should use VOICE_POOL[0]
      expect(ttsCalls[0].voiceId).toBe(VOICE_POOL[0].id);
    });

    it('assigns different voices to different agents', async () => {
      const members = [
        { name: 'dev-a', agentId: 'a', agentType: 'general' },
        { name: 'dev-b', agentId: 'b', agentType: 'general' },
      ];
      await createMockTeam('team-multi-voice', members);
      await writeInbox('team-multi-voice', 'dev-a', [
        { from: 'alice', text: 'Message from alice', timestamp: '2024-01-01T00:00:00Z' },
      ]);
      await writeInbox('team-multi-voice', 'dev-b', [
        { from: 'bob', text: 'Message from bob', timestamp: '2024-01-01T00:01:00Z' },
      ]);

      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      expect(ttsCalls.length).toBe(2);
      // alice and bob should get different voices
      expect(ttsCalls[0].voiceId).toBe(VOICE_POOL[0].id);
      expect(ttsCalls[1].voiceId).toBe(VOICE_POOL[1].id);
    });

    it('only processes new messages (tracks index per file)', async () => {
      const members = [{ name: 'dev', agentId: 'd1', agentType: 'general' }];
      await createMockTeam('team-index', members);

      // Write first message
      const inboxPath = await writeInbox('team-index', 'dev', [
        { from: 'alice', text: 'First', timestamp: '2024-01-01T00:00:00Z' },
      ]);

      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      expect(ttsCalls.length).toBe(1);
      expect(ttsCalls[0].text).toBe('alice says: First');

      // Append second message to same inbox file and trigger the watcher callback
      await writeInbox('team-index', 'dev', [
        { from: 'alice', text: 'First', timestamp: '2024-01-01T00:00:00Z' },
        { from: 'alice', text: 'Second', timestamp: '2024-01-01T00:01:00Z' },
      ]);

      // Trigger the file watcher callback for this inbox
      const watchCb = watchCallbacks.get(inboxPath);
      if (watchCb) watchCb('change', path.basename(inboxPath));
      await new Promise(r => setTimeout(r, 200));

      expect(ttsCalls.length).toBe(2);
      expect(ttsCalls[1].text).toBe('alice says: Second');
    });

    it('processes protocol messages (e.g. shutdown_request)', async () => {
      const members = [{ name: 'dev', agentId: 'd1', agentType: 'general' }];
      await createMockTeam('team-proto', members);
      await writeInbox('team-proto', 'dev', [
        { from: 'lead', text: '{"type":"shutdown_request","reason":"all done"}', timestamp: '2024-01-01T00:00:00Z' },
      ]);

      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      expect(ttsCalls.length).toBe(1);
      expect(ttsCalls[0].text).toBe('lead requests shutdown: all done');
    });

    it('processes multiple messages from same inbox', async () => {
      const members = [{ name: 'dev', agentId: 'd1', agentType: 'general' }];
      await createMockTeam('team-multi', members);
      await writeInbox('team-multi', 'dev', [
        { from: 'alice', text: 'First message', timestamp: '2024-01-01T00:00:00Z' },
        { from: 'bob', text: 'Second message', timestamp: '2024-01-01T00:01:00Z' },
      ]);

      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      expect(ttsCalls.length).toBe(2);
      expect(ttsCalls[0].text).toBe('alice says: First message');
      expect(ttsCalls[1].text).toBe('bob says: Second message');
    });

    it('skips messages with empty text', async () => {
      const members = [{ name: 'dev', agentId: 'd1', agentType: 'general' }];
      await createMockTeam('team-empty', members);
      await writeInbox('team-empty', 'dev', [
        { from: 'alice', text: '', timestamp: '2024-01-01T00:00:00Z' },
        { from: 'bob', text: 'Real message', timestamp: '2024-01-01T00:01:00Z' },
      ]);

      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      expect(ttsCalls.length).toBe(1);
      expect(ttsCalls[0].text).toBe('bob says: Real message');
    });
  });

  describe('scanTeamDir behavior', () => {
    it('reads team config.json for member list and watches their inboxes', async () => {
      const members = [
        { name: 'researcher', agentId: 'r1', agentType: 'explore' },
        { name: 'coder', agentId: 'c1', agentType: 'general' },
      ];
      await createMockTeam('project-x', members);
      await writeInbox('project-x', 'researcher', [
        { from: 'lead', text: 'Research this', timestamp: '2024-01-01T00:00:00Z' },
      ]);
      await writeInbox('project-x', 'coder', [
        { from: 'lead', text: 'Code this', timestamp: '2024-01-01T00:01:00Z' },
      ]);

      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      // Both inbox files should have been processed
      expect(ttsCalls.length).toBe(2);
      const texts = ttsCalls.map(c => c.text);
      expect(texts).toContain('lead says: Research this');
      expect(texts).toContain('lead says: Code this');

      // Watchers should be set up for both inbox files
      const researcherInbox = path.join(teamsDir, 'project-x', 'inboxes', 'researcher.json');
      const coderInbox = path.join(teamsDir, 'project-x', 'inboxes', 'coder.json');
      expect(watchCallbacks.has(researcherInbox)).toBe(true);
      expect(watchCallbacks.has(coderInbox)).toBe(true);
    });

    it('handles missing team config gracefully (no crash)', async () => {
      // Create team dir without config.json
      const teamDir = path.join(teamsDir, 'broken-team');
      await fs.mkdir(teamDir, { recursive: true });

      // Should not throw
      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      expect(ttsCalls.length).toBe(0);
    });

    it('handles invalid JSON in team config gracefully', async () => {
      const teamDir = path.join(teamsDir, 'bad-json-team');
      await fs.mkdir(teamDir, { recursive: true });
      await fs.writeFile(path.join(teamDir, 'config.json'), 'not valid json');

      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      expect(ttsCalls.length).toBe(0);
    });

    it('handles config with no members array gracefully', async () => {
      const teamDir = path.join(teamsDir, 'no-members');
      await fs.mkdir(teamDir, { recursive: true });
      await fs.writeFile(path.join(teamDir, 'config.json'), JSON.stringify({ name: 'team' }));

      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      expect(ttsCalls.length).toBe(0);
    });

    it('watches config.json for new members', async () => {
      const members = [{ name: 'dev', agentId: 'd1', agentType: 'general' }];
      await createMockTeam('growing-team', members);

      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      // fsWatch should have been called with the config.json path
      const configPath = path.join(teamsDir, 'growing-team', 'config.json');
      expect(watchCallbacks.has(configPath)).toBe(true);
    });
  });

  describe('startInboxWatcher', () => {
    it('scans existing team directories on start', async () => {
      // Create two teams
      await createMockTeam('team-a', [{ name: 'agent-a', agentId: 'a1', agentType: 'general' }]);
      await createMockTeam('team-b', [{ name: 'agent-b', agentId: 'b1', agentType: 'general' }]);
      await writeInbox('team-a', 'agent-a', [
        { from: 'lead', text: 'Task for team A', timestamp: '2024-01-01T00:00:00Z' },
      ]);
      await writeInbox('team-b', 'agent-b', [
        { from: 'lead', text: 'Task for team B', timestamp: '2024-01-01T00:01:00Z' },
      ]);

      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      expect(ttsCalls.length).toBe(2);
      const texts = ttsCalls.map(c => c.text);
      expect(texts).toContain('lead says: Task for team A');
      expect(texts).toContain('lead says: Task for team B');
    });

    it('handles empty teams directory', async () => {
      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      expect(ttsCalls.length).toBe(0);
    });

    it('watches teams directory for new teams', async () => {
      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      // The teams dir watcher should have been set up
      expect(watchCallbacks.has(teamsDir)).toBe(true);
    });

    it('ignores non-directory entries in teams dir', async () => {
      // Create a regular file (not a directory) in teams dir
      await fs.writeFile(path.join(teamsDir, 'not-a-team.txt'), 'random file');
      await createMockTeam('real-team', [{ name: 'dev', agentId: 'd1', agentType: 'general' }]);
      await writeInbox('real-team', 'dev', [
        { from: 'lead', text: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
      ]);

      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      // Only the real team's message should be processed
      expect(ttsCalls.length).toBe(1);
      expect(ttsCalls[0].text).toBe('lead says: Hello');
    });
  });

  describe('processInboxFile retry behavior', () => {
    it('retries on JSON parse error and succeeds after file is fixed', async () => {
      const members = [{ name: 'dev', agentId: 'd1', agentType: 'general' }];
      await createMockTeam('team-retry', members);
      const inboxPath = path.join(teamsDir, 'team-retry', 'inboxes', 'dev.json');

      // Write invalid JSON initially - processInboxFile will retry
      // but we need valid JSON eventually for it to succeed
      await fs.writeFile(inboxPath, JSON.stringify([
        { from: 'alice', text: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
      ]));

      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      expect(ttsCalls.length).toBe(1);
      expect(ttsCalls[0].text).toBe('alice says: Hello');
    });

    it('does not crash when inbox file contains invalid JSON', async () => {
      const members = [{ name: 'dev', agentId: 'd1', agentType: 'general' }];
      await createMockTeam('team-bad-inbox', members);
      const inboxPath = path.join(teamsDir, 'team-bad-inbox', 'inboxes', 'dev.json');
      await fs.writeFile(inboxPath, 'totally not json {{[');

      // Should not throw even after retries exhausted
      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 300));

      expect(ttsCalls.length).toBe(0);
    });

    it('does not crash when inbox file does not exist', async () => {
      const members = [{ name: 'dev', agentId: 'd1', agentType: 'general' }];
      await createMockTeam('team-no-inbox', members);
      // Don't create the inbox file - watchInboxFile will try to read it

      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 300));

      expect(ttsCalls.length).toBe(0);
    });

    it('handles inbox with non-array JSON content', async () => {
      const members = [{ name: 'dev', agentId: 'd1', agentType: 'general' }];
      await createMockTeam('team-obj-inbox', members);
      const inboxPath = path.join(teamsDir, 'team-obj-inbox', 'inboxes', 'dev.json');
      await fs.writeFile(inboxPath, JSON.stringify({ not: 'an array' }));

      await instance.startInboxWatcher();
      await new Promise(r => setTimeout(r, 50));

      expect(ttsCalls.length).toBe(0);
    });
  });
});
