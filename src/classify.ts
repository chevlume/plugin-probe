import { isAbsolute } from 'node:path';
import { PLACEHOLDER_ROOT } from './constants.js';
import type { AgentcompatStatus, CapabilityId, CapabilityResult, PluginFacts, Status } from './types.js';

export interface Observation {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  mcpTraces: unknown[];
  hookSync: boolean;
  hookAsync: boolean;
  facts: PluginFacts;
}

const AUTH_RE =
  /not logged in|please (log|sign) in|authentication required|login required|unauthorized|no credentials|missing api key|api key|\/login|codex login|claude auth/i;

const ASYNC_IGNORED_RE = /async hooks are not supported|skipping async hook|ignoring async hook/i;

const MCP_IGNORED_RE = /mcp servers? (are|is) not supported|ignoring \.mcp\.json|plugin mcp .*ignored/i;

const SKILL_IGNORED_RE = /skills? (are|is) not supported|ignoring skills?/i;

const LITERAL_FAILURE_RE = new RegExp(
  `(?:cannot find module|enoent|no such file|not found|spawn|failed to (?:start|launch)|command not found).{0,120}\\$\\{CLAUDE_PLUGIN_ROOT\\}|\\$\\{CLAUDE_PLUGIN_ROOT\\}.{0,120}(?:cannot find module|enoent|no such file|not found|spawn|failed to (?:start|launch)|command not found)`,
  'i',
);

export interface Classification {
  hostFailure: string | null;
  capabilities: CapabilityResult[];
}

export function classifyHost(observation: Observation, failureNote: string | null): Classification {
  if (failureNote) {
    return { hostFailure: failureNote, capabilities: allSkipped(failureNote) };
  }

  const skillSeen = skillObserved(observation.output, observation.facts);
  const literalInTrace = observation.mcpTraces.some(traceShowsLiteral);
  const resolvedInTrace = observation.mcpTraces.some(traceShowsResolved);
  const literalFailure = LITERAL_FAILURE_RE.test(observation.output);
  const anyEvidence =
    observation.mcpTraces.length > 0 ||
    observation.hookSync ||
    observation.hookAsync ||
    skillSeen ||
    literalInTrace ||
    literalFailure ||
    ASYNC_IGNORED_RE.test(observation.output) ||
    MCP_IGNORED_RE.test(observation.output) ||
    SKILL_IGNORED_RE.test(observation.output);

  const failedEarly =
    !anyEvidence &&
    (observation.timedOut ||
      (observation.exitCode !== null && observation.exitCode !== 0) ||
      AUTH_RE.test(observation.output));

  if (failedEarly) {
    const note = earlyFailureNote(observation);
    return { hostFailure: note, capabilities: allSkipped(note) };
  }

  return {
    hostFailure: null,
    capabilities: [
      classifyRoot(observation, { literalInTrace, resolvedInTrace, literalFailure }),
      classifyAsync(observation),
      classifySkill(observation, skillSeen),
    ],
  };
}

function allSkipped(note: string): CapabilityResult[] {
  return [
    skipped('plugin-root-interpolation', note),
    skipped('async-hook', note),
    skipped('skill-discovery', note),
  ];
}

function classifyRoot(
  observation: Observation,
  flags: { literalInTrace: boolean; resolvedInTrace: boolean; literalFailure: boolean },
): CapabilityResult {
  if (!observation.facts.hasMcpPlaceholder) {
    return skipped(
      'plugin-root-interpolation',
      'This plugin does not use ${CLAUDE_PLUGIN_ROOT} in .mcp.json or plugin.json.',
    );
  }
  if (flags.literalInTrace || flags.literalFailure) {
    return result(
      'plugin-root-interpolation',
      'no',
      'no',
      'tested',
      `Host passed ${PLACEHOLDER_ROOT} through literally.`,
    );
  }
  if (flags.resolvedInTrace) {
    return result(
      'plugin-root-interpolation',
      'yes',
      'yes',
      'tested',
      'MCP trace recorded an absolute plugin root.',
    );
  }
  if (MCP_IGNORED_RE.test(observation.output)) {
    return result(
      'plugin-root-interpolation',
      'ignored',
      'ignored',
      'tested',
      'Host output says plugin MCP config is ignored.',
    );
  }
  return result(
    'plugin-root-interpolation',
    'no',
    'no',
    'tested',
    'MCP server did not write a trace.',
  );
}

function classifyAsync(observation: Observation): CapabilityResult {
  if (observation.facts.asyncHookCount === 0) {
    return skipped('async-hook', 'This plugin does not declare an async command hook.');
  }
  if (observation.hookAsync) {
    return result('async-hook', 'yes', 'yes', 'tested', 'Async hook wrote a trace.');
  }
  if (ASYNC_IGNORED_RE.test(observation.output)) {
    return result(
      'async-hook',
      'ignored',
      'ignored',
      'tested',
      'Host output says async hooks are skipped.',
    );
  }
  if (observation.hookSync) {
    return result(
      'async-hook',
      'no',
      'partial',
      'tested',
      'Sync hook ran; the async hook did not.',
    );
  }
  return result('async-hook', 'no', 'no', 'tested', 'Neither hook wrote a trace.');
}

function classifySkill(observation: Observation, skillSeen: boolean): CapabilityResult {
  if (!observation.facts.hasSkills) {
    return skipped('skill-discovery', 'This plugin has no skills/*/SKILL.md.');
  }
  if (skillSeen) {
    return result('skill-discovery', 'yes', 'yes', 'tested', 'Host output included the skill description.');
  }
  if (SKILL_IGNORED_RE.test(observation.output)) {
    return result('skill-discovery', 'ignored', 'ignored', 'tested', 'Host output says skills are ignored.');
  }
  return result('skill-discovery', 'no', 'no', 'tested', 'Skill was not observed in host output.');
}

function earlyFailureNote(observation: Observation): string {
  if (observation.timedOut) return 'Host timed out before writing capability traces.';
  const line = firstUsefulLine(observation.output);
  if (observation.exitCode === null) return line || 'Host exited before writing capability traces.';
  if (line) return `Host exited ${observation.exitCode}: ${line}`;
  return `Host exited ${observation.exitCode} before writing capability traces.`;
}

export function firstUsefulLine(text: string): string {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (line.startsWith('{') || line.startsWith('[')) continue;
    return line.slice(0, 180);
  }
  return '';
}

export function skillObserved(output: string, facts: PluginFacts): boolean {
  for (const needle of facts.skillNeedles) {
    if (needle.length >= 12 && output.includes(needle)) return true;
  }
  for (const name of facts.skillNames) {
    if (name.length < 8) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![\\w./-])${escaped}(?![\\w-])`, 'gi');
    for (const match of output.matchAll(re)) {
      const index = match.index ?? 0;
      const window = output.slice(Math.max(0, index - 60), index + name.length + 60);
      if (/\b(skill|skills|discovered|registered|loaded|available)\b/i.test(window)) return true;
    }
  }
  return false;
}

function traceShowsLiteral(trace: unknown): boolean {
  return JSON.stringify(trace).includes(PLACEHOLDER_ROOT);
}

function traceShowsResolved(trace: unknown): boolean {
  if (!trace || typeof trace !== 'object') return false;
  const record = trace as Record<string, unknown>;
  const values: unknown[] = [record.claudePluginRoot, record.pluginRootEnv, record.scriptPluginRoot];
  if (Array.isArray(record.argv)) values.push(...record.argv);
  return values.some(
    (value) => typeof value === 'string' && isAbsolute(value) && !value.includes('${'),
  );
}

function skipped(id: CapabilityId, note: string): CapabilityResult {
  return result(id, 'skipped', '?', 'skipped', note);
}

function result(
  id: CapabilityId,
  status: Status,
  agentcompat: AgentcompatStatus,
  method: 'tested' | 'skipped',
  note: string,
): CapabilityResult {
  return { id, status, agentcompat, method, note };
}
