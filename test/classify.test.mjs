import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { classifyHost } from '../dist/classify.js';
import { SKILL_TOKEN } from '../dist/constants.js';

const facts = {
  name: 'plugin-probe-canary',
  hasMcpPlaceholder: true,
  placeholders: ['${CLAUDE_PLUGIN_ROOT}'],
  asyncHookCount: 2,
  hasSkills: true,
  skillNeedles: [SKILL_TOKEN],
  skillNames: ['plugin-probe-canary'],
  frontmatterFields: [],
};

function observe(overrides) {
  return {
    output: '',
    exitCode: 0,
    timedOut: false,
    mcpTraces: [],
    hookSync: false,
    hookAsync: false,
    facts,
    ...overrides,
  };
}

function byId(classification, id) {
  const found = classification.capabilities.find((capability) => capability.id === id);
  assert.ok(found, id);
  return found;
}

describe('classifyHost', () => {
  test('absolute MCP trace, both hooks, and the skill token are yes', () => {
    const classification = classifyHost(
      observe({
        output: `registered skill ${SKILL_TOKEN}`,
        mcpTraces: [
          {
            argv: ['node', '/tmp/plugin/scripts/mcp-trace.mjs', '--plugin-root', '/tmp/plugin'],
            claudePluginRoot: '/tmp/plugin',
          },
        ],
        hookSync: true,
        hookAsync: true,
      }),
      null,
    );
    assert.equal(classification.hostFailure, null);
    assert.equal(byId(classification, 'plugin-root-interpolation').status, 'yes');
    assert.equal(byId(classification, 'async-hook').status, 'yes');
    assert.equal(byId(classification, 'skill-discovery').status, 'yes');
    assert.equal(byId(classification, 'skill-discovery').agentcompat, 'yes');
  });

  test('an absolute interpreter path or scriptPluginRoot is not interpolation', () => {
    const classification = classifyHost(
      observe({
        mcpTraces: [
          {
            argv: ['/usr/bin/node', 'scripts/mcp-trace.mjs', '--plugin-root', 'relative'],
            claudePluginRoot: null,
            pluginRootEnv: null,
            scriptPluginRoot: '/tmp/plugin-probe-canary',
          },
        ],
      }),
      null,
    );
    const root = byId(classification, 'plugin-root-interpolation');
    assert.equal(root.status, 'no');
    assert.match(root.note, /absolute plugin root/);
  });

  test('literal placeholder in the MCP trace is no', () => {
    const classification = classifyHost(
      observe({
        mcpTraces: [
          {
            argv: ['node', '${CLAUDE_PLUGIN_ROOT}/scripts/mcp-trace.mjs'],
            claudePluginRoot: '${CLAUDE_PLUGIN_ROOT}',
          },
        ],
        hookSync: true,
      }),
      null,
    );
    const root = byId(classification, 'plugin-root-interpolation');
    assert.equal(root.status, 'no');
    assert.match(root.note, /literally/);
  });

  test('spawn error that still contains the literal placeholder is no', () => {
    const classification = classifyHost(
      observe({
        output: "Error: Cannot find module '${CLAUDE_PLUGIN_ROOT}/scripts/mcp-trace.mjs'",
      }),
      null,
    );
    assert.equal(byId(classification, 'plugin-root-interpolation').status, 'no');
  });

  test('async hook dropped after the sync hook ran is partial for agentcompat and no for the table', () => {
    const classification = classifyHost(observe({ hookSync: true }), null);
    const asyncHook = byId(classification, 'async-hook');
    assert.equal(asyncHook.status, 'no');
    assert.equal(asyncHook.agentcompat, 'partial');
  });

  test('an explicit async-hook skip message is ignored', () => {
    const classification = classifyHost(
      observe({
        output: 'skipping async hook in hooks.json: async hooks are not supported yet',
        hookSync: true,
      }),
      null,
    );
    const asyncHook = byId(classification, 'async-hook');
    assert.equal(asyncHook.status, 'ignored');
    assert.equal(asyncHook.agentcompat, 'ignored');
  });

  test('auth failure with no traces skips every capability', () => {
    const classification = classifyHost(
      observe({
        exitCode: 1,
        output: 'Not logged in. Run claude /login',
      }),
      null,
    );
    assert.ok(classification.hostFailure);
    for (const capability of classification.capabilities) {
      assert.equal(capability.status, 'skipped');
      assert.equal(capability.agentcompat, '?');
      assert.match(capability.note, /Not logged in/);
    }
  });

  test('a plugin without the placeholder skips that capability only', () => {
    const classification = classifyHost(
      observe({
        facts: { ...facts, hasMcpPlaceholder: false, placeholders: [] },
        hookSync: true,
        hookAsync: true,
        output: SKILL_TOKEN,
      }),
      null,
    );
    assert.equal(classification.hostFailure, null);
    assert.equal(byId(classification, 'plugin-root-interpolation').status, 'skipped');
    assert.equal(byId(classification, 'async-hook').status, 'yes');
  });
});
