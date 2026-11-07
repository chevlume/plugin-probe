#!/usr/bin/env node
import { parseArgs } from './args.js';
import { runProbe } from './probe.js';
import { formatJson, formatText } from './report.js';
import { UsageError, helpText } from './usage.js';
import { readToolVersion } from './version.js';

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (!Number.isFinite(nodeMajor) || nodeMajor < 20) {
  process.stderr.write(
    `plugin-probe needs Node.js 20 or newer. This process is Node.js ${process.versions.node}.\n`,
  );
  process.exit(1);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`plugin-probe: ${message}\n`);
    process.exitCode = 1;
  });

async function main(argv: string[]): Promise<number> {
  const json = argv.includes('--json');
  try {
    const options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(helpText());
      return 0;
    }
    const version = readToolVersion();
    if (options.version) {
      process.stdout.write(`${version}\n`);
      return 0;
    }
    if (options.command !== 'probe') {
      process.stdout.write(helpText());
      return 0;
    }
    const report = await runProbe({
      hosts: options.hosts,
      timeoutMs: options.timeoutMs,
      toolVersion: version,
      ...(options.pluginPath !== undefined ? { pluginPath: options.pluginPath } : {}),
    });
    process.stdout.write(options.json ? formatJson(report) : formatText(report));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
    }
    process.stderr.write(`plugin-probe: ${message}\n`);
    return error instanceof UsageError ? 2 : 1;
  }
}
