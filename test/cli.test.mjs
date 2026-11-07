import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { SKILL_TOKEN, TRACE_FILES } from '../dist/constants.js';
import { runProcess } from '../dist/runner.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repo, 'dist', 'cli.js');

function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('help and version', () => {
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /plugin-probe probe/);
  assert.match(help.stdout, /--json/);
  assert.match(help.stdout, /--hosts/);
  assert.match(help.stdout, /npx --yes \. probe/);
  assert.doesNotMatch(help.stdout, /npx plugin-probe/);

  const version = run(['--version']);
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), pkg.version);
});

test('probe without host CLIs prints a skipped table and exits 0', () => {
  const empty = mkdtempSync(join(tmpdir(), 'plugin-probe-path-'));
  try {
    const result = run(['probe', '--hosts', 'claude,codex'], { PATH: empty });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /host\s+version\s+capability\s+status\s+note/);
    assert.match(result.stdout, /claude\s+-\s+plugin-root-interpolation\s+skipped/);
    assert.match(result.stdout, /codex\s+-\s+async-hook\s+skipped/);
    assert.match(result.stdout, /not found on PATH/);
    assert.match(result.stdout, /Nothing was written to ~\/\.claude or ~\/\.codex/);
    assert.doesNotMatch(result.stdout, /\$\{CLAUDE_PLUGIN_ROOT\} was passed literally/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('JSON from a skipped probe validates the schema', () => {
  const empty = mkdtempSync(join(tmpdir(), 'plugin-probe-path-'));
  try {
    const result = run(['probe', '--hosts', 'claude,codex', '--json'], { PATH: empty });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.tool, 'plugin-probe');
    assert.equal(report.hosts.length, 2);
    assert.deepEqual(
      report.hosts[0].capabilities.map((item) => item.id),
      ['plugin-root-interpolation', 'async-hook', 'skill-discovery'],
    );
    assert.ok(report.hosts.every((host) => host.status === 'skipped'));
    assert.ok(report.hosts.every((host) => host.capabilities.every((item) => item.agentcompat === '?')));
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('a missing plugin path is a usage error', () => {
  const result = run(['probe', './no-such-plugin']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /No plugin at/);
});

test('an unknown host is a usage error', () => {
  const result = run(['probe', '--hosts', 'not-a-host']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown host/);
  assert.equal(result.stdout, '');
});

test('--json is honored when argument parsing fails', () => {
  const result = run(['probe', '--hosts', 'not-a-host', '--json']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown host/);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  assert.match(body.error, /Unknown host/);
});

test('a file path and a bad timeout are usage errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-probe-file-'));
  const file = join(dir, 'not-a-directory.txt');
  writeFileSync(file, 'nope\n');
  try {
    const asFile = run(['probe', file]);
    assert.equal(asFile.status, 2);
    assert.match(asFile.stderr, /is a file/);

    const timeout = run(['probe', '--timeout', '50']);
    assert.equal(timeout.status, 2);
    assert.match(timeout.stderr, /between 1000 and 300000/);

    const unknown = run(['explode']);
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /Unknown command explode/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a command that ignores SIGTERM still ends after the timeout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-probe-timeout-'));
  const pidFile = join(dir, 'pid');
  try {
    const result = await runProcess({
      bin: process.execPath,
      args: [
        '-e',
        'const fs=require("node:fs"); fs.writeFileSync(process.argv[1], String(process.pid)); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);',
        pidFile,
      ],
      cwd: repo,
      env: process.env,
      timeoutMs: 300,
    });
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, null);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`timed out process ${pid} is still running`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('canary scripts write traces and do not touch the network', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-probe-canary-'));
  const besidePlugin = join(repo, 'canary', 'plugin-probe-canary', '.probe-traces');
  rmSync(besidePlugin, { recursive: true, force: true });
  try {
    const mcp = spawnSync(
      process.execPath,
      [join(repo, 'canary', 'plugin-probe-canary', 'scripts', 'mcp-trace.mjs'), '--plugin-root', '${CLAUDE_PLUGIN_ROOT}'],
      {
        cwd: repo,
        encoding: 'utf8',
        input: '',
        env: { ...process.env, PLUGIN_PROBE_TRACE_DIR: dir },
      },
    );
    assert.equal(mcp.status, 0, mcp.stderr);
    const trace = JSON.parse(readFileSync(join(dir, TRACE_FILES.mcp), 'utf8'));
    assert.ok(trace.argv.includes('${CLAUDE_PLUGIN_ROOT}'));
    assert.equal(typeof trace.cwd, 'string');
    assert.equal(trace.scriptPluginRoot.endsWith('plugin-probe-canary'), true);

    const hook = spawnSync(
      process.execPath,
      [join(repo, 'canary', 'plugin-probe-canary', 'scripts', 'hook-trace.mjs'), 'async'],
      {
        cwd: repo,
        encoding: 'utf8',
        input: '{"hook_event_name":"SessionStart"}\n',
        env: { ...process.env, PLUGIN_PROBE_TRACE_DIR: dir, CLAUDE_PLUGIN_ROOT: '/plugins/canary' },
      },
    );
    assert.equal(hook.status, 0, hook.stderr);
    const asyncTrace = JSON.parse(readFileSync(join(dir, TRACE_FILES.hookAsync), 'utf8'));
    assert.equal(asyncTrace.kind, 'async');
    assert.equal(asyncTrace.claudePluginRoot, '/plugins/canary');

    const skill = readFileSync(join(repo, 'canary', 'plugin-probe-canary', 'skills', 'plugin-probe-canary', 'SKILL.md'), 'utf8');
    assert.match(skill, new RegExp(SKILL_TOKEN));
    const hooks = readFileSync(join(repo, 'canary', 'plugin-probe-canary', 'hooks', 'hooks.json'), 'utf8');
    assert.match(hooks, /"async": true/);
    const mcpJson = readFileSync(join(repo, 'canary', 'plugin-probe-canary', '.mcp.json'), 'utf8');
    assert.match(mcpJson, /\$\{CLAUDE_PLUGIN_ROOT\}/);
    assert.equal(existsSync(besidePlugin), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
