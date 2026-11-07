import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const scriptPluginRoot = path.resolve(here, '..');

export function writeTrace(filename, payload) {
  const dirs = new Set();
  if (process.env.PLUGIN_PROBE_TRACE_DIR) {
    dirs.add(process.env.PLUGIN_PROBE_TRACE_DIR);
  }
  dirs.add(path.join(scriptPluginRoot, '.probe-traces'));

  const body = JSON.stringify(payload);
  for (const dir of dirs) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), body);
    } catch {
      // The other directory may still be writable.
    }
  }
}

export function basePayload(kind) {
  return {
    kind,
    cwd: process.cwd(),
    argv: process.argv,
    claudePluginRoot: process.env.CLAUDE_PLUGIN_ROOT ?? null,
    pluginRootEnv: process.env.PLUGIN_ROOT ?? null,
    scriptPluginRoot,
  };
}
