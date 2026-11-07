import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function bundledCanaryDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'canary', 'plugin-probe-canary');
}
