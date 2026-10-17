/**
 * Traceability on the row. When a sender finishes a unit, its record (result
 * and the material lots it consumed) is added to the handoff row's metadata
 * in the same statement that records the release, so a search by lot finds
 * every handoff, and so every unit, that used it. The full record stays on
 * the row as the release item.
 */

import { TRACE_FACET, type TraceEntry, type TraceMaterial } from '../contracts';

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function materialsOf(v: unknown): TraceMaterial[] {
  if (!Array.isArray(v)) return [];
  return v.filter((m) => str(m?.material) && str(m?.lot)).map((m) => ({ material: m.material, lot: m.lot }));
}

/** The trace entry for a finished job event from `machineId`. */
export function traceEntry(machineId: string, body: Record<string, any>): TraceEntry {
  return { unitId: String(body.unitId), machineId, jobId: str(body.jobId), result: str(body.result), materials: materialsOf(body.materials) };
}

/** A row's trace as read back from its metadata; entries without a unit or machine are dropped. */
export function readTrace(md: Record<string, any> = {}): TraceEntry[] {
  const raw = md[TRACE_FACET.TRACE];
  if (!Array.isArray(raw)) return [];
  return raw.filter((e) => str(e?.unitId) && str(e?.machineId)).map((e) => ({ ...e, materials: materialsOf(e.materials) }));
}

/** Entries from both lists, one per unit and machine; a later entry replaces an earlier one. */
export function mergeTrace(a: TraceEntry[] = [], b: TraceEntry[] = []): TraceEntry[] {
  const byKey = new Map<string, TraceEntry>();
  for (const e of [...a, ...b]) byKey.set(`${e.unitId}@${e.machineId}`, e);
  return [...byKey.values()];
}

/** The metadata patch for a trace: the entries, and every lot once. */
export function traceFacets(trace: TraceEntry[]): Record<string, unknown> {
  const lots = [...new Set(trace.flatMap((e) => e.materials.map((m) => m.lot)))];
  return { [TRACE_FACET.TRACE]: trace, [TRACE_FACET.LOTS]: lots };
}
