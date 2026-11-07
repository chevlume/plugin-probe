import { DEFAULT_HOSTS, DEFAULT_TIMEOUT_MS } from './constants.js';
import { UsageError } from './usage.js';

export interface CliOptions {
  help: boolean;
  version: boolean;
  json: boolean;
  command: 'probe' | null;
  hosts: string[];
  timeoutMs: number;
  pluginPath?: string;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    version: false,
    json: false,
    command: null,
    hosts: [...DEFAULT_HOSTS],
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  const positionals: string[] = [];
  let hostsSet = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--version' || arg === '-v' || arg === '-V') {
      options.version = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--hosts') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError('--hosts needs a comma-separated list, for example claude,codex');
      }
      i += 1;
      options.hosts = parseHostList(value);
      hostsSet = true;
      continue;
    }
    if (arg.startsWith('--hosts=')) {
      options.hosts = parseHostList(arg.slice('--hosts='.length));
      hostsSet = true;
      continue;
    }
    if (arg === '--timeout') {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new UsageError('--timeout needs a number of milliseconds');
      }
      i += 1;
      options.timeoutMs = parseTimeout(value);
      continue;
    }
    if (arg.startsWith('--timeout=')) {
      options.timeoutMs = parseTimeout(arg.slice('--timeout='.length));
      continue;
    }
    if (arg.startsWith('-')) {
      throw new UsageError(`Unknown option ${arg}. Run plugin-probe --help.`);
    }
    positionals.push(arg);
  }

  if (options.help || options.version) {
    return options;
  }

  if (positionals.length > 0) {
    const [command, ...rest] = positionals;
    if (command !== 'probe') {
      throw new UsageError(`Unknown command ${command ?? ''}. Run plugin-probe --help.`);
    }
    options.command = 'probe';
    if (rest.length > 1) {
      throw new UsageError('probe accepts one plugin path. Example: plugin-probe probe ./my-plugin');
    }
    if (rest[0] !== undefined) {
      options.pluginPath = rest[0];
    }
  }

  if (!hostsSet && options.command === null && !options.help && !options.version) {
    options.help = true;
  }

  if (options.hosts.length === 0) {
    throw new UsageError('--hosts did not include a host. Known hosts: claude, codex');
  }

  return options;
}

function parseHostList(value: string): string[] {
  const hosts: string[] = [];
  for (const part of value.split(',')) {
    const id = part.trim().toLowerCase();
    if (!id) continue;
    if (!hosts.includes(id)) hosts.push(id);
  }
  if (hosts.length === 0) {
    throw new UsageError('--hosts did not include a host. Known hosts: claude, codex');
  }
  return hosts;
}

function parseTimeout(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new UsageError(`--timeout must be a positive integer, got ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1000 || parsed > 300_000) {
    throw new UsageError('--timeout must be between 1000 and 300000 milliseconds');
  }
  return parsed;
}
