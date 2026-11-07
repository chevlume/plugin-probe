import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bundledCanaryDir } from './canary.js';
import { classifyHost, firstUsefulLine } from './classify.js';
import { STRIPPED_ENV } from './constants.js';
import { hostSpec, installAlreadySatisfied, knownHostIds, parseVersion, type HostContext } from './hosts.js';
import { createLayout, ensureCodexProbeConfig, type IsolatedLayout } from './layout.js';
import { createRealRunner } from './runner.js';
import { looksLikePlugin, scanPlugin } from './scan.js';
import { collectTraces } from './traces.js';
import type { CapabilityResult, HostReport, HostRunner, ProbeReport, RunResult } from './types.js';
import { UsageError } from './usage.js';

export interface ProbeOptions {
  hosts: string[];
  pluginPath?: string;
  timeoutMs: number;
  toolVersion: string;
  runner?: HostRunner;
  now?: Date;
}

export async function runProbe(options: ProbeOptions): Promise<ProbeReport> {
  const runner = options.runner ?? createRealRunner();
  const source = resolvePlugin(options.pluginPath);
  const scanned = scanPlugin(source.path, source.source === 'path');
  const root = mkdtempSync(join(tmpdir(), 'plugin-probe-'));
  try {
    const layout = createLayout(root, source.path, scanned.facts.name);
    const hosts: HostReport[] = [];
    for (const id of options.hosts) {
      hosts.push(await probeHost(id, runner, layout, scanned.facts, options.timeoutMs));
    }
    const generatedAt = (options.now ?? new Date()).toISOString();
    return {
      ok: true,
      schemaVersion: 1,
      tool: 'plugin-probe',
      toolVersion: options.toolVersion,
      generatedAt,
      plugin: {
        source: source.source,
        name: scanned.facts.name,
        path: source.path,
      },
      warnings: scanned.warnings,
      hosts,
    };
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // The report is already built. A leftover temp directory is not a failed probe.
    }
  }
}

async function probeHost(
  id: string,
  runner: HostRunner,
  layout: IsolatedLayout,
  facts: ReturnType<typeof scanPlugin>['facts'],
  timeoutMs: number,
): Promise<HostReport> {
  const spec = hostSpec(id);
  if (!spec) {
    throw new UsageError(`Unknown host "${id}". Known hosts: ${knownHostIds().join(', ')}.`);
  }
  const bin = runner.lookup(spec.bin);
  if (!bin) {
    const note = `${spec.bin} was not found on PATH. Install ${spec.name}, or remove it from --hosts.`;
    return hostReport(spec, null, note, allSkipped(note));
  }

  const env = childEnv(layout);
  const versionRun = await runner.run({
    bin,
    args: spec.versionArgs,
    cwd: layout.workDir,
    env,
    timeoutMs: Math.min(10_000, timeoutMs),
  });
  const version = versionRun.spawnError
    ? null
    : parseVersion(`${versionRun.stdout}\n${versionRun.stderr}`);

  const context: HostContext = {
    pluginDir: layout.pluginDir,
    marketRoot: layout.marketRoot,
    workDir: layout.workDir,
    debugFile: layout.debugFile,
    pluginId: layout.pluginId,
  };

  if (spec.installArgs) {
    for (const args of spec.installArgs(context)) {
      const installed = await runner.run({ bin, args, cwd: layout.workDir, env, timeoutMs });
      const failure = installFailure(spec.name, spec.bin, installed, timeoutMs);
      if (failure) {
        return hostReport(spec, version, failure, allSkipped(failure), {
          exitCode: installed.exitCode,
          timedOut: installed.timedOut,
          command: [bin, ...args],
        });
      }
    }
    ensureCodexProbeConfig(layout.codexHome, layout.workDir, layout.pluginId);
  }

  const args = spec.probeArgs(context);
  const run = await runner.run({ bin, args, cwd: layout.workDir, env, timeoutMs });
  const command = [bin, ...args];
  if (run.spawnError) {
    const note = `${spec.bin} failed to start: ${run.spawnError}`;
    return hostReport(spec, version, note, allSkipped(note), {
      exitCode: null,
      timedOut: false,
      command,
    });
  }

  const traces = collectTraces(layout.root, layout.debugFile);
  const output = `${run.stdout}\n${run.stderr}\n${traces.debugLog}`;
  const classified = classifyHost(
    {
      output,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      mcpTraces: traces.mcpTraces,
      hookSync: traces.hookSync,
      hookAsync: traces.hookAsync,
      facts,
    },
    null,
  );
  return hostReport(spec, version, classified.hostFailure, classified.capabilities, {
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    command,
  });
}

function installFailure(
  hostName: string,
  bin: string,
  result: RunResult,
  timeoutMs: number,
): string | null {
  if (result.spawnError) return `${bin} failed to start: ${result.spawnError}`;
  if (result.timedOut) return `${hostName} install timed out after ${timeoutMs}ms.`;
  if (installAlreadySatisfied(result)) return null;
  const line = firstUsefulLine(`${result.stderr}\n${result.stdout}`);
  return `${hostName} did not install the plugin${line ? `: ${line}` : ` (exit ${result.exitCode ?? 'unknown'}).`}`;
}

function hostReport(
  spec: { id: string; name: string },
  version: string | null,
  skipReason: string | null,
  capabilities: CapabilityResult[],
  run?: HostReport['run'],
): HostReport {
  const report: HostReport = {
    id: spec.id,
    name: spec.name,
    version,
    status: skipReason ? 'skipped' : 'probed',
    skipReason,
    capabilities,
  };
  if (run) report.run = run;
  return report;
}

function allSkipped(note: string): CapabilityResult[] {
  return classifyHost(
    {
      output: '',
      exitCode: null,
      timedOut: false,
      mcpTraces: [],
      hookSync: false,
      hookAsync: false,
      facts: {
        name: '',
        hasMcpPlaceholder: false,
        placeholders: [],
        asyncHookCount: 0,
        hasSkills: false,
        skillNeedles: [],
        skillNames: [],
        frontmatterFields: [],
      },
    },
    note,
  ).capabilities;
}

function resolvePlugin(pluginPath: string | undefined): { source: 'canary' | 'path'; path: string } {
  if (pluginPath === undefined) {
    const canary = bundledCanaryDir();
    if (!existsSync(canary)) {
      throw new Error(`Bundled canary is missing at ${canary}. Reinstall plugin-probe.`);
    }
    return { source: 'canary', path: canary };
  }
  const resolved = resolve(pluginPath);
  if (!existsSync(resolved)) {
    throw new UsageError(
      `No plugin at ${pluginPath}. Pass a directory with .claude-plugin/plugin.json, or omit the path to use the bundled canary.`,
    );
  }
  if (!statSync(resolved).isDirectory()) {
    throw new UsageError(`${pluginPath} is a file. Pass the plugin directory.`);
  }
  if (!looksLikePlugin(resolved)) {
    throw new UsageError(
      `${pluginPath} does not look like a Claude-format plugin. Expected .claude-plugin/plugin.json, .mcp.json, hooks/hooks.json, or skills/*/SKILL.md.`,
    );
  }
  return { source: 'path', path: resolved };
}

function childEnv(layout: IsolatedLayout): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of STRIPPED_ENV) delete env[key];
  env.HOME = layout.home;
  env.USERPROFILE = layout.home;
  env.CLAUDE_CONFIG_DIR = layout.claudeConfig;
  env.CODEX_HOME = layout.codexHome;
  env.PLUGIN_PROBE_TRACE_DIR = layout.traceDir;
  env.XDG_CONFIG_HOME = join(layout.home, '.config');
  env.XDG_DATA_HOME = join(layout.home, '.local', 'share');
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  return env;
}
