import { PROBE_PROMPT } from './constants.js';

/**
 * Invocations use documented non-interactive flags:
 * Claude Code `-p`, `--plugin-dir`, `--max-turns`, `--max-budget-usd`,
 * `--permission-mode`, `--output-format`, `--verbose`, `--include-hook-events`,
 * `--debug-file` (https://code.claude.com/docs/en/cli-reference).
 * Codex `exec`, `--skip-git-repo-check`, `--ephemeral`, `--json`, `--sandbox`,
 * `--dangerously-bypass-hook-trust`, `-C`, `-c`
 * (https://developers.openai.com/codex).
 */
export interface HostSpec {
  id: string;
  name: string;
  bin: string;
  versionArgs: string[];
  installArgs?: (context: HostContext) => string[][];
  probeArgs: (context: HostContext) => string[];
}

export interface HostContext {
  pluginDir: string;
  marketRoot: string;
  workDir: string;
  debugFile: string;
  pluginId: string;
}

export const HOSTS: Record<string, HostSpec> = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    bin: 'claude',
    versionArgs: ['--version'],
    probeArgs: (context) => [
      '--plugin-dir',
      context.pluginDir,
      '-p',
      '--max-turns',
      '1',
      '--max-budget-usd',
      '0.01',
      '--permission-mode',
      'dontAsk',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-hook-events',
      '--debug-file',
      context.debugFile,
      PROBE_PROMPT,
    ],
  },
  codex: {
    id: 'codex',
    name: 'Codex CLI',
    bin: 'codex',
    versionArgs: ['--version'],
    installArgs: (context) => [
      ['plugin', 'marketplace', 'add', context.marketRoot, '--json'],
      ['plugin', 'add', context.pluginId, '--json'],
    ],
    probeArgs: (context) => [
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--dangerously-bypass-hook-trust',
      '--json',
      '--sandbox',
      'workspace-write',
      '-c',
      'approval_policy="never"',
      '-c',
      'analytics.enabled=false',
      '-C',
      context.workDir,
      PROBE_PROMPT,
    ],
  },
};

export function knownHostIds(): string[] {
  return Object.keys(HOSTS);
}

export function hostSpec(id: string): HostSpec | null {
  return HOSTS[id] ?? null;
}

export function parseVersion(output: string): string | null {
  const match = output.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  if (match?.[0]) return match[0];
  const line = output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  return line ? line.slice(0, 80) : null;
}

export function installAlreadySatisfied(result: { exitCode: number | null; stdout: string; stderr: string }): boolean {
  if (result.exitCode === 0) return true;
  return /already (added|installed|exists)/i.test(`${result.stdout}\n${result.stderr}`);
}
