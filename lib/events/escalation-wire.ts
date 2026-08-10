import { ESCALATION_METADATA_KEYS } from '../../types';

// ---------------------------------------------------------------------------
// Escalation lifecycle event `data` — the ONE wire shape.
//
// CONVENTION (both publisher families converge here):
//   A lifecycle event's `data` is the wire-safe PROJECTION of the escalation
//   row — routing/classification scalars plus the metadata FACETS — and NEVER
//   the heavy/sensitive JSON columns. A subscriber needing the full row fetches
//   it by id through the authenticated read API; the pub channel is a
//   notification surface, not a transport.
//
//   Dropped from the wire:
//     • envelope / escalation_payload / resolver_payload — workflow envelope,
//       initial payload, resolution content (e.g. mandate detail).
//     • metadata.form_schema — a full JSON Schema some rows embed (tens of KB).
//
//   Kept: the scalar columns (an allowlist, so a column added later never
//   leaks by default) and every other metadata facet (orderId, serialNumber,
//   entity keys, schema_version, …) — the small categorical surface agent
//   triggers filter/map on and the entity/faceted views route by.
//
//   Verb provenance the row can't express (cancel reason, released_by,
//   resolved_by, reassignment from/to) rides as named fields ALONGSIDE the
//   projection via `escalationEventData(row, context)`.
//
// EXCEPTION — bulk paths. `publishBulk*` operate on many rows they do not hold
//   in full; projecting would cost one fetch per row. They publish the minimal
//   delta plus `bulk: true` and let subscribers fetch by id. This is the only
//   sanctioned divergence, and it is marked.
//
// Both the engine-mediated path (lib/events/system-events.ts) and the
// service-mediated path (services/escalation/crud.ts) build `data` through the
// helpers below — one definition, no drift.
// ---------------------------------------------------------------------------

/** Scalar row columns that may ride the wire. Allowlist, not denylist. */
export const WIRE_SAFE_COLUMNS = [
  'id', 'type', 'subtype', 'description', 'status', 'priority',
  'role', 'assigned_to', 'assigned_until',
  'workflow_id', 'workflow_type', 'task_queue',
  'origin_id', 'task_id', 'parent_id', 'signal_key',
  'resolved_at', 'claimed_at',
] as const;

/** Project a committed escalation row to the wire-safe lifecycle shape. */
export function projectEscalationRow(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of WIRE_SAFE_COLUMNS) {
    if (row[key] !== undefined) out[key] = row[key];
  }
  const metadata = row.metadata;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    // Keep the routing facets; drop only the heavy embedded resolver form def.
    const { [ESCALATION_METADATA_KEYS.FORM_SCHEMA]: _omitFormSchema, ...facets } =
      metadata as Record<string, any>;
    out.metadata = facets;
  }
  return out;
}

/**
 * Build a lifecycle event's `data`: the row projection plus any verb provenance
 * the row can't express. The single constructor every single-row publisher uses.
 */
export function escalationEventData(
  row: Record<string, any>,
  context?: Record<string, any>,
): Record<string, any> {
  return { ...projectEscalationRow(row), ...(context ?? {}) };
}
