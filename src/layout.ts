import { cpSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join, sep } from 'node:path';

export interface IsolatedLayout {
  root: string;
  home: string;
  claudeConfig: string;
  codexHome: string;
  pluginDir: string;
  marketRoot: string;
  workDir: string;
  traceDir: string;
  debugFile: string;
  pluginName: string;
  pluginId: string;
}

export function createLayout(root: string, sourcePlugin: string, pluginName: string): IsolatedLayout {
  const marketRoot = join(root, 'market');
  const pluginDir = join(marketRoot, 'plugins', pluginName);
  const layout: IsolatedLayout = {
    root,
    home: join(root, 'home'),
    claudeConfig: join(root, 'claude'),
    codexHome: join(root, 'codex'),
    pluginDir,
    marketRoot,
    workDir: join(root, 'work'),
    traceDir: join(root, 'traces'),
    debugFile: join(root, 'claude-debug.log'),
    pluginName,
    pluginId: `${pluginName}@plugin-probe`,
  };

  mkdirSync(layout.home, { recursive: true });
  mkdirSync(layout.claudeConfig, { recursive: true });
  mkdirSync(layout.codexHome, { recursive: true });
  mkdirSync(layout.workDir, { recursive: true });
  mkdirSync(layout.traceDir, { recursive: true });
  mkdirSync(join(marketRoot, '.agents', 'plugins'), { recursive: true });
  mkdirSync(join(marketRoot, '.claude-plugin'), { recursive: true });

  const sourceRoot = realpathSync(sourcePlugin);
  cpSync(sourcePlugin, pluginDir, {
    recursive: true,
    dereference: true,
    filter: (source) => copySource(source, sourceRoot),
  });

  const marketplace = {
    name: 'plugin-probe',
    interface: { displayName: 'plugin-probe' },
    plugins: [
      {
        name: pluginName,
        source: { source: 'local', path: `./plugins/${pluginName}` },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Productivity',
      },
    ],
  };
  writeFileSync(
    join(marketRoot, '.agents', 'plugins', 'marketplace.json'),
    JSON.stringify(marketplace, null, 2),
  );
  writeFileSync(
    join(marketRoot, '.claude-plugin', 'marketplace.json'),
    JSON.stringify(
      {
        name: 'plugin-probe',
        plugins: [{ name: pluginName, source: `./plugins/${pluginName}` }],
      },
      null,
      2,
    ),
  );
  writeFileSync(join(layout.workDir, 'README.txt'), 'plugin-probe temporary workspace.\n');
  return layout;
}

export function ensureCodexProbeConfig(codexHome: string, workDir: string, pluginId: string): void {
  const file = join(codexHome, 'config.toml');
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    text = '';
  }
  const extra: string[] = [];
  if (!/^approval_policy\s*=/m.test(text)) extra.push('approval_policy = "never"');
  if (!/^sandbox_mode\s*=/m.test(text)) extra.push('sandbox_mode = "workspace-write"');
  if (!text.includes('[analytics]')) extra.push('[analytics]\nenabled = false');
  const project = `[projects.${tomlBasicString(workDir)}]`;
  if (!text.includes(project)) extra.push(`${project}\ntrust_level = "trusted"`);
  const plugin = `[plugins.${tomlBasicString(pluginId)}]`;
  if (!text.includes(plugin)) extra.push(`${plugin}\nenabled = true`);
  if (extra.length === 0) return;
  const body = `${text.replace(/\s*$/, '')}\n\n# plugin-probe isolated run\n${extra.join('\n')}\n`;
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(file, body);
}

export function tomlBasicString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function copySource(source: string, sourceRoot: string): boolean {
  const name = basename(source);
  if (name === 'node_modules' || name === '.git' || name === '.probe-traces') return false;
  try {
    if (!lstatSync(source).isSymbolicLink()) return true;
    const real = realpathSync(source);
    return real === sourceRoot || real.startsWith(`${sourceRoot}${sep}`);
  } catch {
    return false;
  }
}

export function kebabName(raw: string): string {
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return name || 'plugin';
}
