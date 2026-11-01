/**
 * The lines index as the API and the MCP server present it: a registry row
 * joined with what the running surface knows about the line.
 */

import type { LineDef } from '../../lib/machines/line';
import type { LineHealth, LineIndexRow, LineSummary } from '../../types/machines-view';
import type { LineRecordWithHealth } from './registry';
import { summarizeLine, type LineSurface } from './surface';

/** The line as every replica describes it: the surface's own summary when it runs the line, else the stored definition. */
export function lineSummaryOf(surface: LineSurface, siteId: string, lineId: string, stored: LineDef): LineSummary {
  const running = surface.findLine(siteId, lineId)
    ? surface.describeLines().find((l) => l.siteId === siteId && l.lineId === lineId)
    : undefined;
  return running ?? summarizeLine(stored, {});
}

/** A registry row as the index shows it. */
export function toLineIndexRow(surface: LineSurface, record: LineRecordWithHealth): LineIndexRow {
  return {
    ...lineSummaryOf(surface, record.siteId, record.lineId, record.definition),
    source: record.source, version: record.version, enabled: record.enabled, updatedAt: record.updatedAt,
    leading: surface.describeLine(record.siteId, record.lineId) !== null,
    health: record.health,
  };
}

/** Health for a line no pending row names yet. */
export function emptyLineHealth(machines: number): LineHealth {
  return { machines, offline: 0, quiet: 0, alarms: 0, people: 0, handoff: 0, command: 0, attention: false };
}

/** The raw wire payload as a string: an object is serialized, text passes through. */
export function wirePayloadOf(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body === undefined || body === null) return '';
  return JSON.stringify(body);
}
