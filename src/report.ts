import type { ProbeReport } from './types.js';

export function formatJson(report: ProbeReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatText(report: ProbeReport): string {
  const lines: string[] = [];
  lines.push(`${report.tool} ${report.toolVersion}`);
  lines.push(`plugin: ${report.plugin.name} (${report.plugin.source})`);
  lines.push(`path: ${report.plugin.path}`);
  lines.push('');
  if (report.plugin.source === 'canary') {
    lines.push(
      'Using the bundled canary. It references ${CLAUDE_PLUGIN_ROOT}, an async hook, and a skill on purpose.',
    );
    lines.push('');
  }
  if (report.warnings.length > 0) {
    lines.push('Warnings');
    for (const warning of report.warnings) {
      lines.push(`  ${warning.file}: ${warning.message}`);
    }
    lines.push('');
  }
  lines.push(formatTable(report));
  lines.push('');
  lines.push(summaryLine(report));
  return `${lines.join('\n')}\n`;
}

export function formatTable(report: ProbeReport): string {
  const rows: string[][] = [['host', 'version', 'capability', 'status', 'note']];
  for (const host of report.hosts) {
    for (const capability of host.capabilities) {
      rows.push([
        host.id,
        host.version ?? '-',
        capability.id,
        capability.status,
        capability.note,
      ]);
    }
  }
  const widths = rows[0]?.map((_, index) => Math.max(...rows.map((row) => (row[index] ?? '').length))) ?? [];
  return rows
    .map((row) =>
      row
        .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
        .join('  '),
    )
    .join('\n');
}

function summaryLine(report: ProbeReport): string {
  const skipped = report.hosts.filter((host) => host.status === 'skipped').length;
  const probed = report.hosts.length - skipped;
  const hostBits = `${probed} host${probed === 1 ? '' : 's'} probed, ${skipped} skipped`;
  return `${hostBits}. Nothing was written to ~/.claude or ~/.codex.`;
}
