import { createTeamVoicesServer, VOICE_POOL } from '../lib.mjs';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tv-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeServer(overrides = {}) {
  return createTeamVoicesServer({
    generateTTS: async () => {},
    execAsync: async () => {},
    stateDir: tmpDir,
    ...overrides,
  });
}

describe('voice assignment', () => {
  describe('assignVoice (auto round-robin)', () => {
    it('assigns first voice from pool to first agent', async () => {
      const { assignVoice, saveConfig } = makeServer();
      const voice = assignVoice('agent-alpha');
      expect(voice).toEqual(VOICE_POOL[0]);
      await saveConfig();
    });

    it('assigns second voice to second agent', async () => {
      const { assignVoice, saveConfig } = makeServer();
      assignVoice('agent-alpha');
      const voice = assignVoice('agent-beta');
      expect(voice).toEqual(VOICE_POOL[1]);
      await saveConfig();
    });

    it('returns existing assignment for known agent', async () => {
      const { assignVoice, saveConfig } = makeServer();
      const first = assignVoice('agent-alpha');
      const second = assignVoice('agent-alpha');
      expect(second).toBe(first);
      await saveConfig(); // flush fire-and-forget write
    });

    it('wraps around pool when more agents than voices', async () => {
      const { assignVoice, saveConfig } = makeServer();
      for (let i = 0; i < VOICE_POOL.length; i++) {
        assignVoice(`agent-${i}`);
      }
      const wrappedVoice = assignVoice('agent-overflow');
      expect(wrappedVoice).toEqual(VOICE_POOL[0]);
      await saveConfig();
    });

    it('calls saveConfig after new assignment (verify config file written)', async () => {
      const { assignVoice } = makeServer();
      assignVoice('agent-alpha');

      // saveConfig is async but fire-and-forget from assignVoice; wait a tick
      await new Promise(r => setTimeout(r, 50));

      const configPath = path.join(tmpDir, 'config.json');
      const data = JSON.parse(await fs.readFile(configPath, 'utf-8'));
      expect(data.voiceAssignments['agent-alpha']).toEqual(VOICE_POOL[0]);
      expect(data.nextVoiceIndex).toBe(1);
    });
  });

  describe('manualAssignVoice', () => {
    it('assigns by voice name (case-insensitive)', async () => {
      const { manualAssignVoice, saveConfig } = makeServer();
      const voice = manualAssignVoice('agent-alpha', 'rachel');
      expect(voice).toEqual(VOICE_POOL[0]);
      await saveConfig();
    });

    it('assigns by voice ID', async () => {
      const { manualAssignVoice, saveConfig } = makeServer();
      const arnold = VOICE_POOL.find(v => v.name === 'Arnold');
      const voice = manualAssignVoice('agent-alpha', arnold.id);
      expect(voice).toEqual(arnold);
      await saveConfig(); // flush fire-and-forget write
    });

    it('treats unknown string as custom ElevenLabs voice ID', async () => {
      const { manualAssignVoice, saveConfig } = makeServer();
      const customId = 'custom-voice-abc123';
      const voice = manualAssignVoice('agent-alpha', customId);
      expect(voice).toEqual({ name: customId, id: customId });
      await saveConfig(); // flush fire-and-forget write
    });

    it('overrides existing auto-assignment', async () => {
      const { assignVoice, manualAssignVoice, getState, saveConfig } = makeServer();
      assignVoice('agent-alpha'); // auto-assigns VOICE_POOL[0]
      const override = manualAssignVoice('agent-alpha', 'Bella');
      expect(override).toEqual(VOICE_POOL.find(v => v.name === 'Bella'));
      expect(getState().voiceAssignments.get('agent-alpha')).toEqual(
        VOICE_POOL.find(v => v.name === 'Bella'),
      );
      await saveConfig();
    });

    it('calls saveConfig after assignment', async () => {
      const { manualAssignVoice } = makeServer();
      manualAssignVoice('agent-alpha', 'Josh');

      await new Promise(r => setTimeout(r, 50));

      const configPath = path.join(tmpDir, 'config.json');
      const data = JSON.parse(await fs.readFile(configPath, 'utf-8'));
      expect(data.voiceAssignments['agent-alpha']).toEqual(VOICE_POOL[1]);
    });
  });

  describe('getVoiceForAgent', () => {
    it('returns existing assignment', async () => {
      const { assignVoice, getVoiceForAgent, saveConfig } = makeServer();
      const assigned = assignVoice('agent-alpha');
      const retrieved = getVoiceForAgent('agent-alpha');
      expect(retrieved).toBe(assigned);
      await saveConfig();
    });

    it('auto-assigns if no existing assignment', async () => {
      const { getVoiceForAgent, saveConfig } = makeServer();
      const voice = getVoiceForAgent('agent-new');
      expect(voice).toEqual(VOICE_POOL[0]);
      await saveConfig(); // flush fire-and-forget write
    });
  });

  describe('config persistence', () => {
    it('loadConfig restores voice assignments from JSON', async () => {
      const configPath = path.join(tmpDir, 'config.json');
      await fs.writeFile(configPath, JSON.stringify({
        voiceAssignments: {
          'agent-alpha': VOICE_POOL[2],
          'agent-beta': VOICE_POOL[5],
        },
        nextVoiceIndex: 6,
        muted: false,
      }));

      const { loadConfig, getState } = makeServer();
      await loadConfig();

      const state = getState();
      expect(state.voiceAssignments.get('agent-alpha')).toEqual(VOICE_POOL[2]);
      expect(state.voiceAssignments.get('agent-beta')).toEqual(VOICE_POOL[5]);
      expect(state.nextVoiceIndex).toBe(6);
    });

    it('loadConfig restores muted state', async () => {
      const configPath = path.join(tmpDir, 'config.json');
      await fs.writeFile(configPath, JSON.stringify({
        voiceAssignments: {},
        nextVoiceIndex: 0,
        muted: true,
      }));

      const { loadConfig, getState } = makeServer();
      await loadConfig();
      expect(getState().muted).toBe(true);
    });

    it('loadConfig handles missing config file (first run)', async () => {
      const { loadConfig, getState } = makeServer();
      await loadConfig();

      const state = getState();
      expect(state.voiceAssignments.size).toBe(0);
      expect(state.muted).toBe(false);
    });

    it('saveConfig writes correct JSON structure', async () => {
      const { assignVoice, saveConfig } = makeServer();
      assignVoice('agent-alpha');
      assignVoice('agent-beta');

      // Wait for the fire-and-forget saveConfig calls from assignVoice,
      // then call saveConfig explicitly to ensure final state is written
      await saveConfig();

      const configPath = path.join(tmpDir, 'config.json');
      const data = JSON.parse(await fs.readFile(configPath, 'utf-8'));

      expect(data).toEqual({
        voiceAssignments: {
          'agent-alpha': VOICE_POOL[0],
          'agent-beta': VOICE_POOL[1],
        },
        nextVoiceIndex: 2,
        muted: false,
      });
    });

    it('saveConfig creates state directory if missing', async () => {
      const nestedDir = path.join(tmpDir, 'nested', 'state');
      const { saveConfig } = makeServer({ stateDir: nestedDir });
      await saveConfig();

      const configPath = path.join(nestedDir, 'config.json');
      const stat = await fs.stat(configPath);
      expect(stat.isFile()).toBe(true);
    });
  });
});
