export const TOOL_NAME = 'plugin-probe';

export const SCHEMA_VERSION = 1 as const;

export const DEFAULT_HOSTS = ['claude', 'codex'] as const;

export const DEFAULT_TIMEOUT_MS = 20_000;

export const SKILL_TOKEN = 'plugin-probe-skill-token-7f3a';

export const PLACEHOLDER_ROOT = '${CLAUDE_PLUGIN_ROOT}';

export const TRACE_FILES = {
  mcp: 'plugin-probe-mcp.json',
  hookSync: 'plugin-probe-hook-sync.json',
  hookAsync: 'plugin-probe-hook-async.json',
} as const;

export const PROBE_PROMPT =
  'Reply with the single word ok. Do not call tools, do not read files, and do not use the network.';

/** Env vars that would let a host bill an API account. They are not forwarded. */
export const STRIPPED_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'CLAUDE_API_KEY',
] as const;

export const IGNORED_FRONTMATTER = [
  'model',
  'allowed-tools',
  'effort',
  'paths',
  'tools',
  'license',
  'compatibility',
] as const;

export const MCP_PLACEHOLDERS = [
  '${CLAUDE_PLUGIN_ROOT}',
  '${CLAUDE_PLUGIN_DATA}',
  '${CLAUDE_PROJECT_DIR}',
  '${PLUGIN_ROOT}',
  '${PLUGIN_DATA}',
] as const;
