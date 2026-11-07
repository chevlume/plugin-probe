export const TOOL_NAME = 'plugin-probe' as const;

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

/**
 * Environment variables copied into the host process.
 * Everything else, including API keys and tokens, stays in the parent.
 */
export const FORWARDED_ENV = [
  'PATH',
  'PATHEXT',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LANGUAGE',
  'TERM',
  'TZ',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'SHELL',
  'USER',
  'LOGNAME',
  'USERNAME',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'ALL_PROXY',
  'all_proxy',
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
