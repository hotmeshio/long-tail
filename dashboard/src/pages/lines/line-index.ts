import type { LineDefinition, LineIndexRow, LineSort } from '../../api/machines';

/** The tone of a line at a glance: attention, running, or nothing led anywhere yet. */
export type LineTone = 'attention' | 'running' | 'idle';

export const LINE_TONE_DOT: Record<LineTone, string> = {
  attention: 'bg-status-warning',
  running: 'bg-status-success-graphic',
  idle: 'bg-text-quaternary',
};

export const LINE_TONE_LABEL: Record<LineTone, string> = {
  attention: 'needs attention',
  running: 'running',
  idle: 'idle',
};

/** Attention wins; a line with work in flight or a leader is running; otherwise idle. */
export function lineTone(row: LineIndexRow): LineTone {
  if (row.health.attention) return 'attention';
  if (row.leading || row.health.handoff > 0 || row.health.command > 0) return 'running';
  return 'idle';
}

export const SORT_OPTIONS: { value: LineSort; label: string }[] = [
  { value: 'attention', label: 'Attention first' },
  { value: 'site', label: 'Site and line' },
  { value: 'updated', label: 'Recently changed' },
];

export interface SiteGroup {
  siteId: string;
  lines: LineIndexRow[];
  attention: number;
}

/** Rows grouped under their site, in the order the page delivered them. */
export function groupBySite(lines: LineIndexRow[]): SiteGroup[] {
  const groups = new Map<string, SiteGroup>();
  for (const line of lines) {
    const group = groups.get(line.siteId) ?? { siteId: line.siteId, lines: [], attention: 0 };
    group.lines.push(line);
    if (line.health.attention) group.attention += 1;
    groups.set(line.siteId, group);
  }
  return [...groups.values()];
}

/** The starting point for a new declaration: three stations, the fields a line needs. */
export const EXAMPLE_DEFINITION: LineDefinition = {
  siteId: 'site-2',
  lineId: 'line-1',
  machines: [
    { machineId: 'print-01', process: 'print', cycleSec: 12 },
    { machineId: 'press-01', process: 'bond', cycleSec: 8 },
    { machineId: 'inspect-01', process: 'inspect', cycleSec: 5 },
  ],
};

/** The definition the registry holds for a row, as text to edit. */
export function definitionText(def: LineDefinition): string {
  return `${JSON.stringify(def, null, 2)}\n`;
}

/** A row carries its summary fields; the definition is what it declared. */
export function definitionOf(row: LineIndexRow): LineDefinition {
  return {
    siteId: row.siteId,
    lineId: row.lineId,
    machines: row.machines.map((m) => ({
      machineId: m.machineId,
      process: m.process,
      ...(m.address ? { address: m.address } : {}),
    })),
  };
}

/** Parse what was typed; a readable message names what is missing. */
export function parseDefinition(text: string): { ok: true; definition: LineDefinition } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, message: `The definition is not JSON: ${(err as Error).message}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, message: 'The definition must be an object.' };
  const def = parsed as Record<string, unknown>;
  if (typeof def.siteId !== 'string' || !def.siteId) return { ok: false, message: 'siteId is required.' };
  if (typeof def.lineId !== 'string' || !def.lineId) return { ok: false, message: 'lineId is required.' };
  if (!Array.isArray(def.machines) || def.machines.length === 0) return { ok: false, message: 'machines must list at least one machine.' };
  for (const m of def.machines) {
    if (!m || typeof m !== 'object' || typeof (m as { machineId?: unknown }).machineId !== 'string' || typeof (m as { process?: unknown }).process !== 'string') {
      return { ok: false, message: 'Every machine needs a machineId and a process.' };
    }
  }
  return { ok: true, definition: def as unknown as LineDefinition };
}
