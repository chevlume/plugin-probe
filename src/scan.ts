import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { IGNORED_FRONTMATTER, MCP_PLACEHOLDERS, PLACEHOLDER_ROOT, SKILL_TOKEN } from './constants.js';
import { kebabName } from './layout.js';
import type { PluginFacts, Warning } from './types.js';

export interface ScanResult {
  facts: PluginFacts;
  warnings: Warning[];
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.probe-traces', 'dist']);

export function scanPlugin(root: string, warn: boolean): ScanResult {
  const pluginJson = readJsonIfExists(join(root, '.claude-plugin', 'plugin.json'));
  const declaredName = stringField(pluginJson, 'name');
  const name = kebabName(declaredName || basename(root));
  const placeholders = new Set<string>();
  const placeholderFiles: { file: string; found: string[] }[] = [];
  let asyncHookCount = 0;
  const asyncFiles: string[] = [];
  const skillNeedles = new Set<string>();
  const skillNames: string[] = [];
  const frontmatterFields: { file: string; fields: string[] }[] = [];
  let hasSkills = false;

  for (const file of walk(root)) {
    const rel = relative(root, file).split(sep).join('/');
    if (rel === '.mcp.json' || rel === '.claude-plugin/plugin.json') {
      const text = readText(file);
      const found = MCP_PLACEHOLDERS.filter((token) => text.includes(token));
      if (found.length > 0) {
        for (const token of found) placeholders.add(token);
        placeholderFiles.push({ file: rel, found });
      }
    }
    if (rel.endsWith('hooks.json') || rel.endsWith('hooks/hooks.json')) {
      const text = readText(file);
      const matches = text.match(/"async"\s*:\s*true/g);
      if (matches && matches.length > 0) {
        asyncHookCount += matches.length;
        asyncFiles.push(rel);
      }
    }
    if (rel.startsWith('skills/') && rel.endsWith('/SKILL.md')) {
      hasSkills = true;
      const text = readText(file);
      const frontmatter = parseFrontmatter(text);
      const skillName = frontmatter.name || rel.split('/')[1] || 'skill';
      skillNames.push(skillName);
      if (text.includes(SKILL_TOKEN)) skillNeedles.add(SKILL_TOKEN);
      const description = frontmatter.description?.trim();
      if (description && description.length >= 24) skillNeedles.add(description);
      const ignored = IGNORED_FRONTMATTER.filter((field) => frontmatter[field] !== undefined);
      if (ignored.length > 0) frontmatterFields.push({ file: rel, fields: [...ignored] });
    }
  }

  const facts: PluginFacts = {
    name,
    hasMcpPlaceholder: placeholders.has(PLACEHOLDER_ROOT),
    placeholders: [...placeholders],
    asyncHookCount,
    hasSkills,
    skillNeedles: [...skillNeedles],
    skillNames,
    frontmatterFields,
  };

  const warnings: Warning[] = [];
  if (warn) {
    for (const entry of placeholderFiles) {
      warnings.push({
        file: entry.file,
        message: `Uses ${entry.found.join(', ')}. A host that does not interpolate these will spawn the MCP command with the literal text.`,
      });
    }
    if (asyncHookCount > 0) {
      warnings.push({
        file: asyncFiles[0] ?? 'hooks/hooks.json',
        message: `Sets "async": true on ${asyncHookCount} hook${asyncHookCount === 1 ? '' : 's'}. Hosts that drop async hooks will not run them.`,
      });
    }
    for (const entry of frontmatterFields) {
      warnings.push({
        file: entry.file,
        message: `Frontmatter sets ${entry.fields.map((field) => `\`${field}\``).join(', ')}. Some hosts parse these fields and do not apply them.`,
      });
    }
  }

  return { facts, warnings };
}

export function looksLikePlugin(root: string): boolean {
  const markers = [
    join(root, '.claude-plugin', 'plugin.json'),
    join(root, '.mcp.json'),
    join(root, 'hooks', 'hooks.json'),
  ];
  if (markers.some((file) => existsFile(file))) return true;
  const skills = join(root, 'skills');
  if (!existsDir(skills)) return false;
  return walk(skills).some((file) => file.endsWith(`${sep}SKILL.md`) || file.endsWith('/SKILL.md'));
}

function walk(root: string): string[] {
  const found: string[] = [];
  const stack = [root];
  let seen = 0;
  while (stack.length > 0 && seen < 5000) {
    const dir = stack.pop();
    if (!dir) break;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      seen += 1;
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        stack.push(full);
        continue;
      }
      if (entry.isFile()) found.push(full);
    }
  }
  return found;
}

function readJsonIfExists(file: string): Record<string, unknown> | null {
  if (!existsFile(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function existsFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function existsDir(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export function parseFrontmatter(markdown: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match?.[1]) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const parsed = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!parsed?.[1]) continue;
    let value = parsed[2]?.trim() ?? '';
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[parsed[1]] = value;
  }
  return fields;
}
