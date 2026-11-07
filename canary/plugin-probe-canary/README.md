# plugin-probe canary

This is the bundled Claude-format plugin that `plugin-probe` installs into a temporary home.

It does not read secrets and it does not open network connections.

- `.mcp.json` starts `node` with `${CLAUDE_PLUGIN_ROOT}` in `args`. The script writes the argv it actually received.
- `hooks/hooks.json` registers two `SessionStart` command hooks. One is synchronous. One sets `"async": true`. Each writes a trace file if the host runs it.
- `skills/plugin-probe-canary/SKILL.md` carries frontmatter (`model`, `allowed-tools`, `effort`) that some hosts parse and do not apply. The description contains the token `plugin-probe-skill-token-7f3a`.

Trace files are `plugin-probe-mcp.json`, `plugin-probe-hook-sync.json`, and `plugin-probe-hook-async.json`. They are written to `PLUGIN_PROBE_TRACE_DIR` when that variable is set. Otherwise they are written under `.probe-traces/` next to the plugin.
