import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function readToolVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, '..', 'package.json'), 'utf8');
  const parsed = JSON.parse(raw) as { version?: string };
  if (!parsed.version) {
    throw new Error('package.json is missing a version');
  }
  return parsed.version;
}
