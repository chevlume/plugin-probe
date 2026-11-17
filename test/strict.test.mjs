import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repo, 'dist', 'cli.js');
const declared = join(repo, 'test', 'fixtures', 'declared');
const undeclared = join(repo, 'test', 'fixtures', 'undeclared');

function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

// The probe looks up `claude` on PATH and spawns it. This writes that executable
// so a test can drive the real CLI without the Claude Code or Codex packages.
function writeHost(dir, mode) {
  const file = join(dir, 'claude');
  const source = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
if (process.argv.includes('--version')) {
  process.stdout.write('2.1.50 (Claude Code)\\n');
  process.exit(0);
}
const mode = ${JSON.stringify(mode)};
const traceDir = process.env.PLUGIN_PROBE_TRACE_DIR;
if (mode === 'pass') {
  fs.mkdirSync(traceDir, { recursive: true });
  fs.writeFileSync(path.join(traceDir, 'plugin-probe-mcp.json'), JSON.stringify({
    argv: ['node', '/plugin-probe-fixture-root/scripts/mcp-trace.mjs', '--plugin-root', '/plugin-probe-fixture-root'],
    claudePluginRoot: '/plugin-probe-fixture-root',
  }));
  fs.writeFileSync(path.join(traceDir, 'plugin-probe-hook-sync.json'), '{}');
  fs.writeFileSync(path.join(traceDir, 'plugin-probe-hook-async.json'), '{}');
  process.stdout.write('plugin-probe-skill-token-7f3a\\n');
  process.exit(0);
}
if (mode === 'ignored') {
  process.stdout.write('mcp servers are not supported\\nasync hooks are not supported\\nskills are not supported\\n');
  process.exit(0);
}
if (mode === 'fail') process.exit(0);
process.stderr.write('unexpected host mode\\n');
process.exit(1);
`;
  writeFileSync(file, source, { mode: 0o755 });
}

function normalize(stdout) {
  const report = JSON.parse(stdout);
  const walk = (value) => {
    if (typeof value === 'string') return value.replace(/plugin-probe-[A-Za-z0-9_-]+/g, 'plugin-probe-TMP');
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value)) {
        if (key === 'generatedAt') continue;
        out[key] = walk(value[key]);
      }
      return out;
    }
    return value;
  };
  return walk(report);
}

function assertScenario({ name, plugin, pathDir, strictCode, status }) {
  const base = ['probe', '--hosts', 'claude', '--timeout', '5000', plugin];
  const plain = run(base, { PATH: pathDir });
  const plainJson = run([...base, '--json'], { PATH: pathDir });
  const strict = run([...base, '--strict'], { PATH: pathDir });
  const strictJson = run([...base, '--json', '--strict'], { PATH: pathDir });

  assert.equal(plain.status, 0, `${name} no-strict text\\n${plain.stderr}`);
  assert.equal(plainJson.status, 0, `${name} no-strict json\\n${plainJson.stderr}`);
  assert.equal(strict.status, strictCode, `${name} strict text\\n${strict.stderr}`);
  assert.equal(strictJson.status, strictCode, `${name} strict json\\n${strictJson.stderr}`);
  assert.equal(strict.stdout, plain.stdout, `${name} text stdout changed`);

  const left = normalize(plainJson.stdout);
  const right = normalize(strictJson.stdout);
  assert.deepEqual(right, left, `${name} JSON changed under --strict`);
  assert.equal(left.ok, true);
  assert.equal(left.schemaVersion, 1);
  assert.equal(left.tool, 'plugin-probe');
  assert.equal(Object.hasOwn(left, 'strict'), false);
  assert.deepEqual(Object.keys(left).sort(), [
    'hosts',
    'ok',
    'plugin',
    'schemaVersion',
    'tool',
    'toolVersion',
    'warnings',
  ]);
  for (const host of left.hosts) {
    for (const capability of host.capabilities) {
      assert.equal(capability.status, status, `${name} ${capability.id}`);
    }
  }
  assert.equal(plain.stderr, '');
  assert.equal(plainJson.stderr, '');
  if (strictCode === 0) {
    assert.equal(strict.stderr, '');
    assert.equal(strictJson.stderr, '');
  } else {
    assert.match(strict.stderr, /^plugin-probe: --strict: .+\n$/);
    assert.match(strictJson.stderr, /^plugin-probe: --strict: .+\n$/);
    assert.equal(strictJson.stdout.endsWith('\n'), true);
    JSON.parse(strictJson.stdout);
  }
}

test('--strict does not replace usage exit code 2', () => {
  const result = run(['probe', '--strict', '--hosts', 'not-a-host']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown host/);
  assert.equal(result.stdout, '');

  const json = run(['probe', '--strict', '--json', '--hosts', 'not-a-host']);
  assert.equal(json.status, 2);
  const body = JSON.parse(json.stdout);
  assert.equal(body.ok, false);
  assert.match(body.error, /Unknown host/);
});

test('strict exit codes for pass, fail, skipped, and ignored', () => {
  const hostDir = mkdtempSync(join(tmpdir(), 'plugin-probe-host-'));
  const emptyDir = mkdtempSync(join(tmpdir(), 'plugin-probe-empty-'));
  try {
    writeHost(hostDir, 'pass');
    assertScenario({
      name: 'all-pass',
      plugin: declared,
      pathDir: hostDir,
      strictCode: 0,
      status: 'yes',
    });

    writeHost(hostDir, 'fail');
    assertScenario({
      name: 'fail',
      plugin: declared,
      pathDir: hostDir,
      strictCode: 3,
      status: 'no',
    });

    writeHost(hostDir, 'ignored');
    assertScenario({
      name: 'ignored',
      plugin: declared,
      pathDir: hostDir,
      strictCode: 3,
      status: 'ignored',
    });

    writeHost(hostDir, 'pass');
    assertScenario({
      name: 'skipped-undeclared',
      plugin: undeclared,
      pathDir: hostDir,
      strictCode: 3,
      status: 'skipped',
    });

    assertScenario({
      name: 'skipped-missing-cli',
      plugin: declared,
      pathDir: emptyDir,
      strictCode: 3,
      status: 'skipped',
    });
  } finally {
    rmSync(hostDir, { recursive: true, force: true });
    rmSync(emptyDir, { recursive: true, force: true });
  }
});
