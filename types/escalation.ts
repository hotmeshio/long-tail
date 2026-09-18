import type { Types } from '@hotmeshio/hotmesh';

/**
 * Resolution provenance delivered to a waiting workflow under the reserved
 * `$resolution` signal key — who resolved the escalation and which row
 * delivered it. Declare it in the `conditional` payload generic to consume it.
 * Re-exported from the HotMesh SDK so workflow authors import one package.
 */
export type EscalationResolution = Types.EscalationResolution;

/**
 * Outcome vocabulary for batch-item submissions (`resolveBatchItem`).
 * `completed` = this was the last declared item: the row resolved and the
 * waiting workflow was woken with the full collection. `accepted` = interim
 * fill; the row stays pending. Re-exported from the HotMesh SDK.
 */
export type BatchItemOutcome = Types.BatchItemOutcome;

/**
 * The open accumulator's declaration (`conditional`'s `accumulate` field):
 * `max` is the count trigger (absent = unbounded), `resolveAtMax: false`
 * makes it a cap only, `unique: false` lets a repeated key replace its
 * entry. Re-exported from the HotMesh SDK.
 */
export type AccumulateConfig = Types.AccumulateConfig;

/**
 * What an accumulator wait resolves with on every terminal path except
 * cancel: the ordered `$accumulated` collection and the `$trigger` that
 * ended the wait (`count` | `timeout` | `resolve`). `P` types each item's
 * payload; `R` types the manual resolver payload merged in on `resolve`.
 */
export type AccumulatorResult<
  P = Record<string, unknown>,
  R extends Record<string, unknown> = Record<string, unknown>,
> = Types.AccumulatorResult<P, R>;
export type AccumulatedItem<P = Record<string, unknown>> = Types.AccumulatedItem<P>;
export type AccumulatorTrigger = Types.AccumulatorTrigger;

/**
 * Outcome vocabulary for accumulator adds (`accumulateItem`). `completed` =
 * this add reached `max`: the row resolved and the waiting workflow woke
 * with the collection. `accepted` = the item landed; the row stays pending.
 * `reciprocal-*` = the second row blocked the add and neither row changed.
 */
export type AccumulateItemOutcome = Types.AccumulateItemOutcome;
export type RemoveAccumulatedItemOutcome = Types.RemoveAccumulatedItemOutcome;

/**
 * Reserved batch-accumulator keys, written by the SDK's `batch` fold at
 * escalation creation. Facets (`batch_pending`, `batch_count`, `batch_keys`)
 * live on the GIN-indexed metadata surface; the payload accumulator
 * (`batch_items`) lives on the unindexed envelope — payloads are plumbing,
 * not facets.
 */
export const ESCALATION_BATCH_KEYS = {
  /** Metadata: item keys still awaiting submission (queryable via `@>`). */
  PENDING: 'batch_pending',
  /** Metadata: count of items still awaiting submission. */
  COUNT: 'batch_count',
  /** Metadata: the immutable declared item-key list. */
  KEYS: 'batch_keys',
  /** Envelope: the accumulated `Record<itemKey, payload>` map. */
  ITEMS: 'batch_items',
  /** Envelope: `Record<itemKey, iso8601>` fill timestamps from the database clock. */
  FILLED_AT: 'batch_filled_at',
  /** Envelope: set by `partialOnTimeout`; the timer delivers the filled items. */
  PARTIAL_ON_TIMEOUT: 'batch_partial_on_timeout',
} as const;

/**
 * Reserved open-accumulator keys, written by the SDK's `accumulate` fold at
 * escalation creation. Facets (`accumulate_count`, `accumulate_max`,
 * `accumulate_keys`) live on the GIN-indexed metadata surface; the item
 * store (`accumulate_items`) and the folded options (`accumulate_config`)
 * live on the unindexed envelope.
 */
export const ESCALATION_ACCUMULATE_KEYS = {
  /** Metadata: items held right now. */
  COUNT: 'accumulate_count',
  /** Metadata: the count trigger, or null when unbounded. */
  MAX: 'accumulate_max',
  /** Metadata: held item keys (queryable via `@>`). */
  KEYS: 'accumulate_keys',
  /** Envelope: `Record<itemKey, { payload?, at, actor?, reciprocalId? }>`. */
  ITEMS: 'accumulate_items',
  /** Envelope: the folded `{ unique, resolveAtMax }` options. */
  CONFIG: 'accumulate_config',
} as const;

/** Reserved `$`-prefixed keys on a delivered accumulator collection. */
export const ACCUMULATOR_RESULT_KEYS = {
  ACCUMULATED: '$accumulated',
  TRIGGER: '$trigger',
} as const;

/**
 * Reserved keys inside `lt_escalations.metadata`. Everything else in the bag
 * is caller-owned. These ride the GIN-indexed surface so they survive the
 * engine's atomic Leg1 write untouched and are queryable like any facet.
 */
export const ESCALATION_METADATA_KEYS = {
  /**
   * Pins the lt_role_schemas version this escalation was created against.
   * The resolver UI renders that exact snapshot even after the role's schema
   * moves on; absent, the latest role schema applies. Set ergonomically via
   * `conditional`'s `schemaVersion` config field.
   */
  SCHEMA_VERSION: 'schema_version',
  /** Per-escalation resolver form override — a full JSON Schema embedded on the row. */
  FORM_SCHEMA: 'form_schema',
} as const;

/**
 * Reserved keys inside the escalation `envelope` — the unindexed, render-only
 * bag (like `formDefaults`). System form plumbing lives here, never on the
 * GIN-indexed metadata facet surface.
 */
export const ESCALATION_ENVELOPE_KEYS = {
  /**
   * Versioned knowledge lookup refs: `EscalationLookupRef[]`. Each ref pins
   * an immutable knowledge edition; its presence on the row grants the
   * escalation's role the right to fetch that edition via
   * GET /escalations/:id/lookups, and the resolved content addresses in
   * forms as the `lookup.<as ?? key>` context domain. Set ergonomically via
   * `conditional`'s `lookups` config field.
   */
  LOOKUPS: 'lookups',
} as const;

/**
 * One versioned knowledge lookup reference. `version` is required by design:
 * a ref names an immutable edition, never a moving target. Evolve the list by
 * writing the entry (a new version mints automatically) and repinning here.
 * `as` renames the ref's form-context address when the key alone is ambiguous.
 */
export interface EscalationLookupRef {
  domain: string;
  key: string;
  version: number;
  as?: string;
}

/**
 * Fail-loud structural validation for lookup refs, run before the escalation
 * row is written on every creation path. Dependency-free: the `conditional`
 * fold runs workflow-side.
 */
export function assertLookupRefs(refs: unknown): asserts refs is EscalationLookupRef[] {
  if (!Array.isArray(refs)) {
    throw new Error('lookups must be an array of { domain, key, version } refs');
  }
  for (const ref of refs) {
    const r = (ref ?? {}) as Record<string, unknown>;
    if (typeof r.domain !== 'string' || r.domain.length === 0
      || typeof r.key !== 'string' || r.key.length === 0) {
      throw new Error('Each lookup ref requires a non-empty domain and key');
    }
    if (typeof r.version !== 'number' || !Number.isInteger(r.version) || r.version < 1) {
      throw new Error(
        `Lookup ref ${r.domain}/${r.key} requires a positive integer version — refs pin immutable editions`,
      );
    }
    if (r.as !== undefined && (typeof r.as !== 'string' || r.as.length === 0)) {
      throw new Error(`Lookup ref ${r.domain}/${r.key}: "as" must be a non-empty string when present`);
    }
  }
}

export type LTEscalationStatus =
  | 'pending'
  | 'resolved'
  | 'cancelled'
  /** SLA timer on a `conditional`/`condition` wait fired first — the workflow resumed with `false`; the row is terminal */
  | 'expired';

export type LTEscalationPriority = 1 | 2 | 3 | 4;

export interface LTEscalationRecord {
  id: string;

  // classification
  type: string;
  subtype: string;
  description: string | null;

  // state
  status: LTEscalationStatus;
  priority: LTEscalationPriority;

  // references
  task_id: string | null;
  origin_id: string | null;
  parent_id: string | null;

  // workflow routing (for signaling the paused workflow)
  workflow_id: string | null;
  task_queue: string | null;
  workflow_type: string | null;

  // efficient (atomic) escalation resume key — set when the row was written
  // inside a workflow's Leg1 checkpoint via `condition(signalId, config)` /
  // `conditional(signalId, config)`. The value is the signal id used to resume
  // the waiting workflow in place. Null for service-created rows.
  signal_key: string | null;

  // routing / ownership
  role: string;
  assigned_to: string | null;
  assigned_until: Date | null;

  // timeline
  resolved_at: Date | null;
  claimed_at: Date | null;

  // payload
  envelope: string;
  metadata: Record<string, any> | null;
  escalation_payload: string | null;
  resolver_payload: string | null;

  // telemetry
  trace_id: string | null;
  span_id: string | null;

  created_at: Date;
  updated_at: Date;
}

/**
 * An escalation is "effectively claimed" when assigned_to is set
 * and assigned_until is in the future. Status remains 'pending'.
 */
export function isEffectivelyClaimed(esc: LTEscalationRecord): boolean {
  return !!(
    esc.assigned_to &&
    esc.assigned_until &&
    esc.assigned_until > new Date()
  );
}

/**
 * An escalation is "available" when status is pending and
 * either unassigned or the assignment has expired.
 */
export function isAvailable(esc: LTEscalationRecord): boolean {
  return (
    esc.status === 'pending' &&
    (!esc.assigned_to || !esc.assigned_until || esc.assigned_until <= new Date())
  );
}
