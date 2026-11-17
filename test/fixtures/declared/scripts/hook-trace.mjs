import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.PLUGIN_PROBE_TRACE_DIR;
if (!dir) process.exit(0);
const kind = process.argv[2] === 'async' ? 'async' : 'sync';
const filename = kind === 'async' ? 'plugin-probe-hook-async.json' : 'plugin-probe-hook-sync.json';
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, filename),
  JSON.stringify({ kind, claudePluginRoot: process.env.CLAUDE_PLUGIN_ROOT ?? null }),
);
process.exit(0);
