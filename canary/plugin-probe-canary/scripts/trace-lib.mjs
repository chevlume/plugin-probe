import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const scriptPluginRoot = path.resolve(here, '..');

export function writeTrace(filename, payload) {
  const dir = process.env.PLUGIN_PROBE_TRACE_DIR || path.join(scriptPluginRoot, '.probe-traces');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), JSON.stringify(payload));
  } catch {
    // The probe still reports a missing trace if this directory is not writable.
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
