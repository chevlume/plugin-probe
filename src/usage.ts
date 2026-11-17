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
  --strict         Exit 3 unless every capability status is yes
  --timeout <ms>   Per-command timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})
  -h, --help       Show this help
  -v, --version    Print the version

Known hosts: claude, codex

Omit plugin-path to probe the bundled canary. Pass a directory to probe your
own Claude-format plugin. A host CLI that is not installed is marked skipped.
Without --strict, skipped and failed rows still exit 0.

Capability statuses: yes, no, ignored, skipped. --strict passes only when
every status is yes. no, ignored, skipped, and any other status exit 3.

Exit codes:
  0  Probe finished. With --strict, every capability status is yes.
  1  Unexpected failure, including Node.js older than 20.
  2  Bad arguments, or a path that is not a plugin.
  3  --strict, and at least one capability status is not yes.

The probe sets HOME, CLAUDE_CONFIG_DIR, and CODEX_HOME to a temporary directory.
It does not read or write ~/.claude or ~/.codex.

Examples:
  plugin-probe probe --hosts claude,codex
  plugin-probe probe --json ./my-plugin
  plugin-probe probe --strict --hosts claude,codex
  plugin-probe probe --hosts codex --timeout 45000 ./my-plugin

From a git checkout, before this package is on npm, run those commands with:
  npx --yes . probe --hosts claude,codex
`;
}
