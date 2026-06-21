import type { Types } from '@hotmeshio/hotmesh';

import type {
  LTEscalationRecord,
  LTEscalationStatus,
  LTEscalationPriority,
} from '../../types';

// ---------------------------------------------------------------------------
// Translation between the SDK's `EscalationEntry` (JSONB columns, nullable
// classification) and long-tail's `LTEscalationRecord` public shape (envelope
// and *_payload as JSON strings, non-null type/subtype/role). The public shape
// is frozen — controllers, the SDK facade, and tests depend on it exactly.
// ---------------------------------------------------------------------------

type EscalationEntry = Types.EscalationEntry;

/** Serialize a JSONB object column back to the TEXT form the public shape uses. */
function toJsonText(value: Record<string, unknown> | null | undefined): string | null {
  return value == null ? null : JSON.stringify(value);
}

/** SDK row → long-tail public record. */
export function toEscalationRecord(entry: EscalationEntry): LTEscalationRecord {
  return {
    id: entry.id,
    type: entry.type ?? '',
    subtype: entry.subtype ?? '',
    description: entry.description,
    status: entry.status as LTEscalationStatus,
    priority: entry.priority as LTEscalationPriority,
    task_id: entry.task_id,
    origin_id: entry.origin_id,
    parent_id: entry.parent_id,
    workflow_id: entry.workflow_id,
    task_queue: entry.task_queue,
    workflow_type: entry.workflow_type,
    signal_key: entry.signal_key,
    role: entry.role ?? '',
    assigned_to: entry.assigned_to,
    assigned_until: entry.assigned_until,
    resolved_at: entry.resolved_at,
    claimed_at: entry.claimed_at,
    envelope: entry.envelope == null ? '{}' : JSON.stringify(entry.envelope),
    metadata: entry.metadata as Record<string, any> | null,
    escalation_payload: toJsonText(entry.escalation_payload),
    resolver_payload: toJsonText(entry.resolver_payload),
    trace_id: entry.trace_id,
    span_id: entry.span_id,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
  };
}

export function toEscalationRecords(entries: EscalationEntry[]): LTEscalationRecord[] {
  return entries.map(toEscalationRecord);
}

/**
 * Parse a TEXT/JSON-string field from the public input shape into the JSONB
 * object the SDK expects. Returns `undefined` (field omitted) for empty/invalid
 * input so the column stays NULL rather than storing garbage.
 */
export function toJsonObject(
  value: string | null | undefined,
): Record<string, unknown> | undefined {
  if (value == null || value === '') return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Parse an envelope string, always yielding an object (defaults to `{}`). */
export function toEnvelopeObject(value: string | null | undefined): Record<string, unknown> {
  return toJsonObject(value) ?? {};
}
