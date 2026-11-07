import { DEFAULT_HOSTS, DEFAULT_TIMEOUT_MS } from './constants.js';

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export function helpText(): string {
  return `plugin-probe — see which parts of a Claude-format plugin a host actually runs

Usage:
  plugin-probe probe [options] [plugin-path]
  plugin-probe --help
  plugin-probe --version

Commands:
  probe     Copy a plugin into an isolated temporary home and try each host CLI

Options:
  --hosts <list>   Comma-separated host ids (default: ${DEFAULT_HOSTS.join(',')})
  --json           Print the report as JSON on stdout
  --timeout <ms>   Per-command timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})
  -h, --help       Show this help
  -v, --version    Print the version

Known hosts: claude, codex

Omit plugin-path to probe the bundled canary. Pass a directory to probe your
own Claude-format plugin. A host CLI that is not installed is marked skipped.
Skipped hosts do not fail the run.

The probe sets HOME, CLAUDE_CONFIG_DIR, and CODEX_HOME to a temporary directory.
It does not read or write ~/.claude or ~/.codex.

Examples:
  plugin-probe probe --hosts claude,codex
  plugin-probe probe --json ./my-plugin
  plugin-probe probe --hosts codex --timeout 45000 ./my-plugin

From a git checkout, before this package is on npm, run those commands with:
  npx --yes . probe --hosts claude,codex
`;
}
