import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TRACE_FILES } from './constants.js';

const SKIP_DIRS = new Set(['node_modules', '.git']);

export interface CollectedTraces {
  mcpTraces: unknown[];
  hookSync: boolean;
  hookAsync: boolean;
  debugLog: string;
}

export function collectTraces(root: string, debugFile: string): CollectedTraces {
  const mcpTraces: unknown[] = [];
  let hookSync = false;
  let hookAsync = false;
  const stack = [root];
  let seen = 0;
  while (stack.length > 0 && seen < 8000) {
    const dir = stack.pop();
    if (!dir) break;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      seen += 1;
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === TRACE_FILES.mcp) {
        const parsed = readJson(full);
        if (parsed !== undefined) mcpTraces.push(parsed);
      } else if (entry.name === TRACE_FILES.hookSync) {
        hookSync = true;
      } else if (entry.name === TRACE_FILES.hookAsync) {
        hookAsync = true;
      }
    }
  }
  return {
    mcpTraces,
    hookSync,
    hookAsync,
    debugLog: readLimited(debugFile, 500_000),
  };
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function readLimited(file: string, max: number): string {
  try {
    if (!statSync(file).isFile()) return '';
    return readFileSync(file, 'utf8').slice(0, max);
  } catch {
    return '';
  }
}
