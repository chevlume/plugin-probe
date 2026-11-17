#!/usr/bin/env node
import { parseArgs } from './args.js';
import { runProbe } from './probe.js';
import { formatJson, formatText } from './report.js';
import type { ProbeReport } from './types.js';
import { UsageError, helpText } from './usage.js';
import { readToolVersion } from './version.js';

/** Probe finished and, with --strict, every capability status is yes. */
const EXIT_OK = 0;
/** Unexpected failure, including Node.js older than 20. */
const EXIT_ERROR = 1;
/** Bad arguments, or a path that is not a plugin. */
const EXIT_USAGE = 2;
/** --strict, and at least one capability status is not yes. */
const EXIT_STRICT = 3;

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (!Number.isFinite(nodeMajor) || nodeMajor < 20) {
  process.stderr.write(
    `plugin-probe needs Node.js 20 or newer. This process is Node.js ${process.versions.node}.\n`,
  );
  process.exit(EXIT_ERROR);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`plugin-probe: ${message}\n`);
    process.exitCode = EXIT_ERROR;
  });

async function main(argv: string[]): Promise<number> {
  const json = argv.includes('--json');
  try {
    const options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(helpText());
      return EXIT_OK;
    }
    const version = readToolVersion();
    if (options.version) {
      process.stdout.write(`${version}\n`);
      return EXIT_OK;
    }
    if (options.command !== 'probe') {
      process.stdout.write(helpText());
      return EXIT_OK;
    }
    const report = await runProbe({
      hosts: options.hosts,
      timeoutMs: options.timeoutMs,
      toolVersion: version,
      ...(options.pluginPath !== undefined ? { pluginPath: options.pluginPath } : {}),
    });
    process.stdout.write(options.json ? formatJson(report) : formatText(report));
    if (!options.strict) return EXIT_OK;
    const failure = strictFailureLine(report);
    if (failure === null) return EXIT_OK;
    process.stderr.write(`plugin-probe: --strict: ${failure}\n`);
    return EXIT_STRICT;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
    }
    process.stderr.write(`plugin-probe: ${message}\n`);
    return error instanceof UsageError ? EXIT_USAGE : EXIT_ERROR;
  }
}

/**
 * Capability statuses are `yes`, `no`, `ignored`, and `skipped`.
 * `yes` passes. Every other status, including any added later, fails --strict.
 */
function strictFailureLine(report: ProbeReport): string | null {
  const counts = new Map<string, number>();
  for (const host of report.hosts) {
    for (const capability of host.capabilities) {
      if (capability.status === 'yes') continue;
      counts.set(capability.status, (counts.get(capability.status) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return null;
  const order = ['no', 'ignored', 'skipped'];
  const parts: string[] = [];
  for (const status of order) {
    const count = counts.get(status);
    if (count === undefined) continue;
    parts.push(`${count} ${status}`);
    counts.delete(status);
  }
  for (const status of [...counts.keys()].sort()) {
    parts.push(`${counts.get(status)} ${status}`);
  }
  return `${parts.join(', ')}.`;
}
