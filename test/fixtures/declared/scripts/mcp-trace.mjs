import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.PLUGIN_PROBE_TRACE_DIR;
if (!dir) process.exit(0);
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, 'plugin-probe-mcp.json'),
  JSON.stringify({
    argv: process.argv.slice(1),
    claudePluginRoot: process.env.CLAUDE_PLUGIN_ROOT ?? null,
  }),
);
process.exit(0);
