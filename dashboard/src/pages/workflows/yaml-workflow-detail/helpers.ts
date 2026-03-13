export type Section = 'invoke' | 'tools' | 'config';

export function buildSkeleton(schema: Record<string, any>): Record<string, any> {
  if (!schema?.properties) return {};
  const result: Record<string, any> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    const p = prop as any;
    if (p.default !== undefined) result[key] = p.default;
    else if (p.type === 'string') result[key] = '';
    else if (p.type === 'number' || p.type === 'integer') result[key] = 0;
    else if (p.type === 'boolean') result[key] = false;
    else if (p.type === 'object') result[key] = {};
    else if (p.type === 'array') result[key] = [];
    else result[key] = null;
  }
  return result;
}

export function inferFieldType(schemaProp: any): string {
  if (!schemaProp) return 'string';
  return schemaProp.type || 'string';
}

export const metadataLabels: Record<string, string> = {
  app: 'MCP Workflow Server', tpc: 'MCP Workflow Tool', vrs: 'Version', ngn: 'Engine ID',
  jid: 'Job ID', gid: 'Run ID', aid: 'Activity ID', ts: 'Time Series',
  jc: 'Created', ju: 'Updated', trc: 'Trace ID', js: 'Job Status',
};

export const jobStatusLabels: Record<number, string> = { 0: 'Completed', 1: 'Pending', 2: 'Error' };

export function parseCompactTimestamp(val: string): string {
  const match = val.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d+)$/);
  if (!match) return val;
  const [, y, mo, d, h, mi, s, ms] = match;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}.${ms}`;
}

export function formatMetadataValue(key: string, value: unknown): string {
  if (key === 'js' && typeof value === 'number') return jobStatusLabels[value] ?? `Unknown (${value})`;
  if ((key === 'jc' || key === 'ju') && typeof value === 'string') return parseCompactTimestamp(value);
  return String(value ?? '');
}

export function sourceLabel(s: string | undefined) {
  if (s === 'llm') return 'LLM';
  if (s === 'db') return 'DB';
  return 'MCP';
}

export function sourceColor(s: string | undefined) {
  if (s === 'llm') return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
  return 'bg-accent-primary/10 text-accent border-accent-primary/20';
}
