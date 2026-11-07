# plugin-probe

`plugin-probe` runs a Claude-format plugin against the coding-agent CLIs installed on your machine and tells you which parts those hosts actually executed.

Codex, VS Code/Copilot, Grok Build, and OpenCode can already load plugins written for Claude Code. They do not all implement the same parts. A variable such as `${CLAUDE_PLUGIN_ROOT}` may be passed through as literal text, a hook marked `"async": true` may be dropped at load, and a skill may be present on disk without the host ever surfacing it. Checking the schema, or reading a compatibility table that somebody filled in by hand, does not show what your installed version does.

This tool copies a plugin into a temporary home directory, runs the host headlessly when that CLI exists, and reads the traces the plugin left behind. Each row is `yes`, `no`, `ignored`, or `skipped`.

This version probes the Claude Code CLI (`claude`) and the Codex CLI (`codex`).

## Install

Node.js 20 or newer. No API key. plugin-probe is not published to npm. From any other directory, `npx plugin-probe` fails because the registry has no such package.

Clone the repository and run this checkout:

```bash
git clone https://github.com/chevlume/plugin-probe.git
cd plugin-probe
npm install
npx --yes . probe --hosts claude,codex
```

`npm install` builds the TypeScript. `npx --yes .` runs the checkout you are in. In this directory, `npx plugin-probe` runs that same local program and does not download anything. The built file is `dist/cli.js`.

```bash
node dist/cli.js probe --hosts claude,codex
```

Host CLIs are optional. If `claude` or `codex` is not on `PATH`, that host is marked `skipped` and the command still exits 0.

## What a run does

1. Copies the plugin into a fresh temporary directory. Your `~/.claude` and `~/.codex` are not read or written. `HOME`, `CLAUDE_CONFIG_DIR`, and `CODEX_HOME` point at that temporary directory.
2. For Claude Code, loads the copy with `--plugin-dir` and runs `claude -p` for one turn, with `--max-turns 1` and `--max-budget-usd 0.01`.
3. For Codex, adds a temporary local marketplace with `codex plugin marketplace add` and `codex plugin add`, then runs `codex exec --skip-git-repo-check`. Hook trust is bypassed with `--dangerously-bypass-hook-trust` so the run is not stuck on an interactive prompt. That flag applies only to this temporary `CODEX_HOME` and only to the plugin you asked to probe.
4. Reads trace files and the host's stdout, stderr, and Claude debug log.
5. Prints one row per host and capability.

The host process receives `PATH`, locale, temporary-directory, CA certificate, and proxy variables. API keys, tokens, and the rest of your environment are not forwarded. A normal login stored in your real home directory is not visible to the host, because `HOME` points at the temporary directory. If the CLI exits before it loads the plugin, the rows are `skipped` and the note quotes the host's error. That is a finished probe, not a crash.

Probing executes the plugin's MCP command and hooks. Point it at a plugin you trust. The bundled canary only writes local trace files.

There is no telemetry. plugin-probe does not open network connections of its own. A host CLI you already installed may, if that host gets far enough to start a turn.

## Probe the bundled canary

```bash
npx --yes . probe --hosts claude,codex
```

The canary is a small Claude-format plugin:

- `.mcp.json` starts `node` with `${CLAUDE_PLUGIN_ROOT}` in its arguments. The script records the argv it received.
- `hooks/hooks.json` registers two `SessionStart` hooks. One is synchronous. One sets `"async": true`. Each writes a trace file if the host runs it.
- `skills/plugin-probe-canary/SKILL.md` has frontmatter some hosts parse and do not apply (`model`, `allowed-tools`, `effort`). Its description contains a fixed token the probe looks for in host output.

On a machine without those CLIs the table looks like this:

```text
plugin-probe 0.1.0
plugin: plugin-probe-canary (canary)
path: /path/to/plugin-probe/canary/plugin-probe-canary

Using the bundled canary. It references ${CLAUDE_PLUGIN_ROOT}, an async hook, and a skill on purpose.

host    version  capability                 status   note
claude  -        plugin-root-interpolation  skipped  claude was not found on PATH. Install Claude Code, or remove it from --hosts.
claude  -        async-hook                 skipped  claude was not found on PATH. Install Claude Code, or remove it from --hosts.
claude  -        skill-discovery            skipped  claude was not found on PATH. Install Claude Code, or remove it from --hosts.
codex   -        plugin-root-interpolation  skipped  codex was not found on PATH. Install Codex CLI, or remove it from --hosts.
codex   -        async-hook                 skipped  codex was not found on PATH. Install Codex CLI, or remove it from --hosts.
codex   -        skill-discovery            skipped  codex was not found on PATH. Install Codex CLI, or remove it from --hosts.

0 hosts probed, 2 skipped. Nothing was written to ~/.claude or ~/.codex.
```

The path in that sample is illustrative. The statuses are what you get when the CLIs are absent. When a CLI is present, `version` is filled from `claude --version` or `codex --version`, and `status` comes from traces rather than from this README.

| status | meaning |
| --- | --- |
| `yes` | The host did the thing. An MCP trace showed an absolute plugin root, the async hook wrote a file, or the host output included the skill description. |
| `no` | The host ran and the check failed. The placeholder was still literal, or the async hook never wrote a trace. |
| `ignored` | The host said it was skipping the feature (for example "async hooks are not supported") and left no trace. |
| `skipped` | The CLI is missing, the process exited before it could load the plugin, or this plugin does not declare that feature. |

`no` with agentcompat `partial` means a related piece worked: the sync hook ran and the async hook did not, and the host did not say it was skipping async hooks.

These public reports are why the canary checks those three behaviors. A row in your table is a measurement from your CLIs. It is not, by itself, a confirmation that a given upstream issue still reproduces.

- [openai/codex#19582](https://github.com/openai/codex/issues/19582) — `${CLAUDE_PLUGIN_ROOT}` in `.mcp.json`
- [openai/codex#34694](https://github.com/openai/codex/issues/34694) — plugin hooks with `"async": true`
- [microsoft/vscode#332896](https://github.com/microsoft/vscode/issues/332896) — plugin skills not found
- [microsoft/vscode#314020](https://github.com/microsoft/vscode/issues/314020) — plugin frontmatter not applied

[agentcompat](https://github.com/tainguyen091994/agentcompat) keeps a hand-maintained matrix and says it is not a test suite. [acplugin](https://github.com/TokenRollAI/acplugin) converts plugin formats and does not run the hosts. plugin-probe runs them.

## Probe your own plugin

```bash
npx --yes . probe ./canary/plugin-probe-canary
npx --yes . probe --hosts codex --json ./canary/plugin-probe-canary
```

Use any plugin directory in place of `./canary/plugin-probe-canary`. The directory should contain at least one of `.claude-plugin/plugin.json`, `.mcp.json`, `hooks/hooks.json`, or `skills/*/SKILL.md`.

Before the table, plugin-probe prints warnings when:

- `.mcp.json` or `plugin.json` uses `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}`, `${PLUGIN_ROOT}`, or `${PLUGIN_DATA}`
- a hooks file sets `"async": true`
- a skill sets frontmatter that some hosts ignore (`model`, `allowed-tools`, `effort`, `paths`, `tools`, `license`, `compatibility`)

The original plugin directory is not modified. The same temporary home is used.

A plugin that does not write plugin-probe trace files can still be judged from host output. If the host logs a failed spawn that still contains the literal `${CLAUDE_PLUGIN_ROOT}`, the interpolation row is `no`. If the plugin simply does not declare a feature, that row is `skipped` with a note saying so.

## JSON

`--json` prints one document on stdout. Errors go to stderr as `plugin-probe: ...`. When `--json` was passed and the command fails, stdout is `{"ok":false,"error":"..."}`.

A successful document looks like this, abridged to one capability. The values are an example of the shape, not a measurement from a host:

```json
{
  "ok": true,
  "schemaVersion": 1,
  "tool": "plugin-probe",
  "toolVersion": "0.1.0",
  "generatedAt": "2026-11-07T00:00:00.000Z",
  "plugin": {
    "source": "canary",
    "name": "plugin-probe-canary",
    "path": "/absolute/path/to/the/plugin"
  },
  "warnings": [],
  "hosts": [
    {
      "id": "claude",
      "name": "Claude Code",
      "version": "2.1.50",
      "status": "probed",
      "skipReason": null,
      "capabilities": [
        {
          "id": "plugin-root-interpolation",
          "status": "yes",
          "agentcompat": "yes",
          "method": "tested",
          "note": "MCP trace recorded an absolute plugin root."
        }
      ],
      "run": {
        "exitCode": 0,
        "timedOut": false,
        "command": ["/usr/local/bin/claude", "--plugin-dir", "/tmp/...", "-p"]
      }
    }
  ]
}
```

`status` is `yes`, `no`, `ignored`, or `skipped`.

`agentcompat` uses the same idea as the [agentcompat](https://github.com/tainguyen091994/agentcompat) matrix: `yes`, `no`, `partial`, `ignored`, or `?`. `skipped` is reported as `?`. A sync hook that ran while its async sibling did not is `no` in `status` and `partial` in `agentcompat`.

`method` is `tested` when the host process actually ran the probe, and `skipped` when it did not.

`plugin.source` is `canary` or `path`.

## Commands

From this checkout:

```bash
npx --yes . --help
npx --yes . --version
npx --yes . probe --hosts claude,codex
```

`plugin-probe` is the same program once the built binary is on your `PATH`.

| option | meaning |
| --- | --- |
| `--hosts claude,codex` | Which CLIs to try. Default is both. Unknown ids are an error. |
| `--json` | Machine-readable report on stdout. |
| `--timeout 20000` | Per-command timeout in milliseconds (1000–300000). Default 20000. |

Exit 0 when the probe finishes, including when every host is skipped. Exit 2 for a bad command line or a plugin path that is not a plugin. Exit 1 for an unexpected failure.

## Requirements

- Node.js 20 or newer
- Optional: the `claude` CLI ([Claude Code](https://code.claude.com/docs/en/overview)) and/or the `codex` CLI ([Codex](https://developers.openai.com/codex))
- No account and no API key for plugin-probe itself

## Development

```bash
npm install
npm test
npm run typecheck
```

Tests use a mocked host runner. They do not need Claude, Codex, or network access. CI runs install, typecheck, and test on Node 20 and Node 22.

## License

Copyright 2026 Chevlume.

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Anyone may use, modify, and commercialize the software, including in proprietary products, provided they retain the copyright notice and LICENSE (Apache-2.0 attribution).

Chevlume: https://github.com/chevlume
