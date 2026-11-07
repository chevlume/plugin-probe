import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { SKILL_TOKEN, TRACE_FILES } from '../dist/constants.js';
import { runProbe } from '../dist/probe.js';
import { formatJson } from '../dist/report.js';

const version = '0.1.0';

function ok(stdout = '', stderr = '', exitCode = 0) {
  return { exitCode, signal: null, stdout, stderr, timedOut: false };
}

function createMock(mode) {
  const calls = [];
  return {
    calls,
    lookup(bin) {
      if (mode.missing?.includes(bin)) return null;
      return `/usr/local/bin/${bin}`;
    },
    async run(request) {
      calls.push(request);
      if (request.args.includes('--version')) {
        const text = request.bin.endsWith('codex') ? 'codex-cli 0.55.0\n' : '2.1.50 (Claude Code)\n';
        return ok(text);
      }
      if (request.args[0] === 'plugin') return ok('{"ok":true}\n');
      const traceDir = request.env.PLUGIN_PROBE_TRACE_DIR;
      assert.equal(typeof traceDir, 'string');
      if (mode.auth) {
        return ok('', 'Not logged in. Run claude /login\n', 1);
      }
      if (mode.literal) {
        writeFileSync(
          join(traceDir, TRACE_FILES.mcp),
          JSON.stringify({
            argv: ['node', '${CLAUDE_PLUGIN_ROOT}/scripts/mcp-trace.mjs', '--plugin-root', '${CLAUDE_PLUGIN_ROOT}'],
            claudePluginRoot: '${CLAUDE_PLUGIN_ROOT}',
          }),
        );
        writeFileSync(join(traceDir, TRACE_FILES.hookSync), JSON.stringify({ kind: 'sync' }));
        return ok('', 'skipping async hook in hooks.json: async hooks are not supported yet\n');
      }
      if (mode.yes) {
        writeFileSync(
          join(traceDir, TRACE_FILES.mcp),
          JSON.stringify({
            argv: ['node', '/tmp/plugin/scripts/mcp-trace.mjs', '--plugin-root', '/tmp/plugin'],
            claudePluginRoot: '/tmp/plugin',
            scriptPluginRoot: '/tmp/plugin',
          }),
        );
        writeFileSync(join(traceDir, TRACE_FILES.hookSync), '{}');
        writeFileSync(join(traceDir, TRACE_FILES.hookAsync), '{}');
        return ok(`skill ${SKILL_TOKEN}\n`);
      }
      return ok('');
    },
  };
}

function capability(report, hostId, id) {
  const host = report.hosts.find((item) => item.id === hostId);
  assert.ok(host, hostId);
  const found = host.capabilities.find((item) => item.id === id);
  assert.ok(found, id);
  return { host, capability: found };
}

describe('runProbe', () => {
  test('a missing host is skipped and the other host can still be yes', async () => {
    const runner = createMock({ missing: ['codex'], yes: true });
    const report = await runProbe({
      hosts: ['claude', 'codex'],
      timeoutMs: 5000,
      toolVersion: version,
      runner,
      now: new Date('2026-11-07T00:00:00.000Z'),
    });
    assert.equal(report.plugin.source, 'canary');
    assert.equal(capability(report, 'claude', 'plugin-root-interpolation').capability.status, 'yes');
    assert.equal(capability(report, 'claude', 'async-hook').capability.status, 'yes');
    assert.equal(capability(report, 'claude', 'skill-discovery').capability.status, 'yes');
    assert.equal(capability(report, 'claude', 'plugin-root-interpolation').host.status, 'probed');
    assert.equal(capability(report, 'claude', 'plugin-root-interpolation').host.version, '2.1.50');
    const skipped = capability(report, 'codex', 'async-hook');
    assert.equal(skipped.host.status, 'skipped');
    assert.equal(skipped.capability.status, 'skipped');
    assert.match(skipped.capability.note, /codex was not found on PATH/);
    assert.equal(skipped.host.version, null);

    const claudeProbe = runner.calls.find((call) => call.args.includes('-p'));
    assert.ok(claudeProbe);
    assert.ok(claudeProbe.args.includes('--plugin-dir'));
    assert.ok(claudeProbe.args.includes('--max-turns'));
    assert.equal(claudeProbe.args.includes('--headless'), false);
    assert.equal(claudeProbe.env.HOME.includes(`${join('home')}`) || claudeProbe.env.HOME !== process.env.HOME, true);
    assert.notEqual(claudeProbe.env.HOME, process.env.HOME);
    assert.ok(claudeProbe.env.CLAUDE_CONFIG_DIR);
    assert.equal(claudeProbe.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(claudeProbe.env.OPENAI_API_KEY, undefined);
  });

  test('literal plugin root and a dropped async hook are reported from traces', async () => {
    const runner = createMock({ literal: true, missing: ['codex'] });
    const report = await runProbe({
      hosts: ['claude'],
      timeoutMs: 5000,
      toolVersion: version,
      runner,
    });
    assert.equal(capability(report, 'claude', 'plugin-root-interpolation').capability.status, 'no');
    assert.equal(capability(report, 'claude', 'async-hook').capability.status, 'ignored');
    assert.equal(capability(report, 'claude', 'skill-discovery').capability.status, 'no');
  });

  test('auth failure skips the host instead of failing the probe', async () => {
    const runner = createMock({ auth: true });
    const report = await runProbe({
      hosts: ['claude', 'codex'],
      timeoutMs: 5000,
      toolVersion: version,
      runner,
    });
    for (const host of report.hosts) {
      assert.equal(host.status, 'skipped');
      assert.match(host.skipReason, /Not logged in/);
      for (const item of host.capabilities) assert.equal(item.status, 'skipped');
    }
    const codexProbe = runner.calls.find((call) => call.bin.endsWith('codex') && call.args[0] === 'exec');
    assert.ok(codexProbe);
    assert.ok(codexProbe.args.includes('--skip-git-repo-check'));
    assert.ok(codexProbe.args.includes('--dangerously-bypass-hook-trust'));
    assert.ok(codexProbe.args.includes('--json'));
    assert.equal(codexProbe.env.CODEX_HOME.includes('codex'), true);
    assert.notEqual(codexProbe.env.CODEX_HOME, process.env.CODEX_HOME);
  });

  test('JSON output has a stable schema and agentcompat statuses', async () => {
    const runner = createMock({ yes: true, missing: ['codex'] });
    const report = await runProbe({
      hosts: ['claude', 'codex'],
      timeoutMs: 5000,
      toolVersion: version,
      runner,
      now: new Date('2026-11-07T03:00:00.000Z'),
    });
    const parsed = JSON.parse(formatJson(report));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.tool, 'plugin-probe');
    assert.equal(parsed.toolVersion, version);
    assert.equal(parsed.generatedAt, '2026-11-07T03:00:00.000Z');
    assert.equal(parsed.plugin.source, 'canary');
    assert.equal(parsed.warnings.length, 0);
    assert.equal(parsed.hosts.length, 2);
    const statuses = new Set(['yes', 'no', 'ignored', 'skipped']);
    const agentcompat = new Set(['yes', 'no', 'partial', 'ignored', '?']);
    for (const host of parsed.hosts) {
      assert.equal(host.capabilities.length, 3);
      for (const item of host.capabilities) {
        assert.ok(statuses.has(item.status));
        assert.ok(agentcompat.has(item.agentcompat));
        assert.equal(typeof item.note, 'string');
        assert.ok(item.note.length > 0);
      }
    }
    assert.ok(parsed.hosts[0].run.command.includes('-p'));
  });

  test('a user plugin path is warned and left unchanged', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plugin-probe-user-'));
    const plugin = join(root, 'my-plugin');
    mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
    mkdirSync(join(plugin, 'hooks'), { recursive: true });
    mkdirSync(join(plugin, 'skills', 'review-helper'), { recursive: true });
    const mcp = `{
  "mcpServers": {
    "review": {
      "command": "node",
      "args": ["\${CLAUDE_PLUGIN_ROOT}/server.js", "\${CLAUDE_PLUGIN_DATA}"]
    }
  }
}
`;
    writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), '{"name":"review-helper","version":"1.0.0"}\n');
    writeFileSync(join(plugin, '.mcp.json'), mcp);
    writeFileSync(
      join(plugin, 'hooks', 'hooks.json'),
      '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"node hook.js","async":true}]}]}}\n',
    );
    writeFileSync(
      join(plugin, 'skills', 'review-helper', 'SKILL.md'),
      `---
name: review-helper
description: Reviews a pull request for style and missing tests before you merge.
model: haiku
allowed-tools: Read
---

Review the diff.
`,
    );
    const before = readFileSync(join(plugin, '.mcp.json'));
    try {
      const runner = createMock({ literal: true, missing: ['codex'] });
      const report = await runProbe({
        hosts: ['claude'],
        pluginPath: plugin,
        timeoutMs: 5000,
        toolVersion: version,
        runner,
      });
      assert.equal(report.plugin.source, 'path');
      assert.equal(report.plugin.name, 'review-helper');
      assert.deepEqual(readFileSync(join(plugin, '.mcp.json')), before);
      const files = report.warnings.map((warning) => warning.file);
      assert.ok(files.includes('.mcp.json'));
      assert.ok(report.warnings.some((warning) => warning.message.includes('${CLAUDE_PLUGIN_ROOT}')));
      assert.ok(report.warnings.some((warning) => warning.message.includes('${CLAUDE_PLUGIN_DATA}')));
      assert.ok(report.warnings.some((warning) => warning.message.includes('async')));
      assert.ok(report.warnings.some((warning) => warning.file.endsWith('SKILL.md') && warning.message.includes('model')));
      assert.equal(capability(report, 'claude', 'plugin-root-interpolation').capability.status, 'no');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects a path that is not a plugin', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plugin-probe-empty-'));
    try {
      await assert.rejects(
        () =>
          runProbe({
            hosts: ['claude'],
            pluginPath: root,
            timeoutMs: 5000,
            toolVersion: version,
            runner: createMock({ missing: ['claude'] }),
          }),
        /does not look like a Claude-format plugin/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
