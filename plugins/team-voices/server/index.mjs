import { createTeamVoicesServer } from './lib.mjs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const { server, loadConfig, startInboxWatcher } = createTeamVoicesServer();

async function main() {
  await loadConfig();
  await startInboxWatcher();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => { process.stderr.write(`[team-voices] Fatal: ${err.message}\n`); process.exit(1); });
