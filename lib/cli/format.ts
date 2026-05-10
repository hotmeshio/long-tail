import pc from 'picocolors';

interface Column {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'right';
  format?: (value: any) => string;
}

/** Print a formatted table to stdout */
export function printTable(rows: Record<string, any>[], columns: Column[]): void {
  if (rows.length === 0) {
    console.log(pc.dim('\n  No results.\n'));
    return;
  }

  // Calculate column widths
  const widths = columns.map((col) => {
    const headerLen = col.label.length;
    const maxDataLen = rows.reduce((max, row) => {
      const val = col.format ? col.format(row[col.key]) : String(row[col.key] ?? '');
      return Math.max(max, val.length);
    }, 0);
    return col.width || Math.min(Math.max(headerLen, maxDataLen) + 2, 40);
  });

  // Header
  const header = columns.map((col, i) => {
    const text = col.label.toUpperCase();
    return col.align === 'right' ? text.padStart(widths[i]) : text.padEnd(widths[i]);
  }).join('  ');
  console.log(`\n  ${pc.dim(header)}`);

  // Rows
  for (const row of rows) {
    const line = columns.map((col, i) => {
      const raw = row[col.key];
      const text = col.format ? col.format(raw) : String(raw ?? '');
      const truncated = text.length > widths[i] ? text.slice(0, widths[i] - 1) + '…' : text;
      return col.align === 'right' ? truncated.padStart(widths[i]) : truncated.padEnd(widths[i]);
    }).join('  ');
    console.log(`  ${line}`);
  }
  console.log();
}

/** Print JSON to stdout (for piping) */
export function printJson(data: any): void {
  console.log(JSON.stringify(data, null, 2));
}

/** Print IDs only, one per line (quiet mode) */
export function printIds(rows: Record<string, any>[], idKey = 'id'): void {
  for (const row of rows) {
    console.log(row[idKey]);
  }
}

/** Format a timestamp for table display */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return d.toLocaleDateString();
}

/** Format a status with color */
export function formatStatus(status: string): string {
  switch (status) {
    case 'pending': return pc.yellow(status);
    case 'claimed': return pc.blue(status);
    case 'resolved': return pc.green(status);
    case 'active': return pc.green(status);
    case 'draft': return pc.dim(status);
    case 'deployed': return pc.cyan(status);
    case 'archived': return pc.dim(status);
    case 'failed': return pc.red(status);
    case 'running': return pc.blue(status);
    case 'completed': return pc.green(status);
    default: return status;
  }
}

/** Standard output handler — table, json, or quiet based on flags */
export function output(
  data: any,
  rows: Record<string, any>[],
  columns: Column[],
  opts: { json?: boolean; quiet?: boolean },
  idKey = 'id',
): void {
  if (opts.json) return printJson(data);
  if (opts.quiet) return printIds(rows, idKey);
  printTable(rows, columns);
}
