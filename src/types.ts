export const CAPABILITIES = ['plugin-root-interpolation', 'async-hook', 'skill-discovery'] as const;

export type CapabilityId = (typeof CAPABILITIES)[number];

export type Status = 'yes' | 'no' | 'ignored' | 'skipped';

/** Status vocabulary used by agentcompat's matrix. `skipped` maps to `?`. */
export type AgentcompatStatus = 'yes' | 'no' | 'partial' | 'ignored' | '?';

export interface Warning {
  file: string;
  message: string;
}

export interface PluginFacts {
  name: string;
  hasMcpPlaceholder: boolean;
  placeholders: string[];
  asyncHookCount: number;
  hasSkills: boolean;
  skillNeedles: string[];
  skillNames: string[];
  frontmatterFields: { file: string; fields: string[] }[];
}

export interface CapabilityResult {
  id: CapabilityId;
  status: Status;
  agentcompat: AgentcompatStatus;
  method: 'tested' | 'skipped';
  note: string;
}

export interface HostRunInfo {
  exitCode: number | null;
  timedOut: boolean;
  command: string[];
}

export interface HostReport {
  id: string;
  name: string;
  version: string | null;
  status: 'probed' | 'skipped';
  skipReason: string | null;
  capabilities: CapabilityResult[];
  run?: HostRunInfo;
}

export interface ProbeReport {
  ok: true;
  schemaVersion: 1;
  tool: 'plugin-probe';
  toolVersion: string;
  generatedAt: string;
  plugin: {
    source: 'canary' | 'path';
    name: string;
    path: string;
  };
  warnings: Warning[];
  hosts: HostReport[];
}

export interface RunRequest {
  bin: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}

export interface HostRunner {
  lookup(bin: string): string | null;
  run(request: RunRequest): Promise<RunResult>;
}
