// ─── Faceted escalation analytics ────────────────────────────────────────────
//
// Grouped/temporal reads over the escalation queue. Every escalation is one
// open interval `[created_at, ended_at)` — `ended_at` is the instant the row
// left the live set (resolved / cancelled / expired), NULL while live. The
// aggregate surface reads that time-series three ways: membership at an
// instant, dwell (open-seconds) over a window, and a per-entity timeline.
// Like the rest of the faceted surface, "state" and "entity" stay caller
// concepts expressed as `(role, subtype)` + metadata facets.

import type { FacetQuery } from './facets';

/** Top-level columns a caller may group/select on. Anything else is a facet. */
export const GROUPABLE_COLUMNS = ['role', 'subtype', 'status'] as const;
export type GroupableColumn = (typeof GROUPABLE_COLUMNS)[number];

/**
 * The analytics filter — a FacetQuery's WHAT fields, plus the entity shortcut:
 * `entity` names an entity facet key and resolves server-side to every role
 * declaring it (`lt_roles.entity_facet`) — the entity's SYSTEM. Mutually
 * exclusive with `role`/`roles`; the resolved system also implies
 * `exists: [entity]` so stray rows without the entity stay out.
 */
export type AnalyticsQuery = FacetQuery & {
  entity?: string;
};

/** What to group the aggregate by. Empty groupBy → a single total row. */
export interface FacetGroupBy {
  /** Whitelisted top-level columns (GROUPABLE_COLUMNS). */
  columns?: GroupableColumn[];
  /** Metadata facet keys, projected as text (NULL group key when absent). */
  facets?: string[];
  /**
   * Group by the derived STATE label: each role contributes per its
   * entity_state_source — its subtypes (`'subtype'`) or itself (`'role'`).
   * Returned as `state` on each row. Mutually exclusive with `states[]`.
   */
  state?: boolean;
}

/** A time window, half-open `[from, to)`. */
export interface AnalyticsWindow {
  from: Date | string;
  to: Date | string;
}

/**
 * The measure — exactly one kind.
 * - `membership`: count entities/rows whose interval is open at `asOf`
 *   (default now). A past `asOf` reconstructs the live set at that moment.
 * - `dwell`: seconds each group's intervals were open within the window,
 *   clipped to the window on both ends.
 */
export type AggregateMeasure =
  | {
      kind: 'membership';
      asOf?: Date | string;
    }
  | {
      kind: 'dwell';
      window: AnalyticsWindow;
    };

/** Predicate a group row must satisfy to receive a state label. */
export interface StateMatch {
  role?: string;
  roles?: string[];
  subtype?: string;
  /** Equality on projected facet values (text projections). */
  facets?: Record<string, unknown>;
  /** Projected facet must be non-NULL on the group. */
  exists?: string[];
}

/** Order the RESULT groups (not the underlying rows). */
export interface AggregateOrder {
  /** `count`, `dwellSeconds`, `sampleCount`, a grouped column, or a grouped facet key. */
  field: string;
  direction?: 'asc' | 'desc';
}

export interface AggregateByFacetsInput {
  /**
   * The filter. `role`/`roles` (or `entity`), `facets`, `block`, `range`,
   * `exists` apply verbatim. `status`, `available`, and `jeopardy` are
   * REJECTED here — liveness is derived from the interval + measure
   * (`liveStatuses`).
   */
  query: AnalyticsQuery;
  groupBy: FacetGroupBy;
  measure: AggregateMeasure;
  /**
   * membership only: count DISTINCT of this metadata facet per group
   * (e.g. a machine-id facet → entities, not rows). Omit → count rows.
   */
  distinctBy?: string;
  /**
   * Optional labeling: tag each group with the FIRST matching state name
   * (evaluated top-to-bottom). Pure labeling; grouping is unchanged.
   */
  states?: Array<{
    name: string;
    match: StateMatch;
  }>;
  /** Statuses considered live. Default ['pending']. */
  liveStatuses?: string[];
  orderBy?: AggregateOrder[];
  limit?: number;
  offset?: number;
}

export interface AggregateRow {
  /** Present iff requested in groupBy.columns. */
  role?: string;
  subtype?: string;
  /** Current status — status history is not stored, so a past `asOf` still groups by the row's status NOW. */
  status?: string;
  /** One entry per groupBy.facets key; NULL when the facet is absent on the underlying rows. */
  facets: Record<string, string | null>;
  /** Present iff `states` supplied and one matched. */
  state?: string;
  /** membership: entities (with distinctBy) or rows (without). */
  count?: number;
  /** dwell: summed open-seconds within the window. */
  dwellSeconds?: number;
  /** Underlying escalation rows contributing to this group (pre-distinct). */
  sampleCount: number;
}

/** `overflow` = the group cap was hit; more groups exist beyond this page. */
export interface AggregateByFacetsResult {
  groups: AggregateRow[];
  overflow: boolean;
}

export interface TimelineByFacetInput {
  /** The entity, matched GIN-served (`metadata @> {key: value}`) — the value must be stored as a JSON string. */
  facet: {
    key: string;
    value: string;
  };
  /** Optional extra filter / role scope (or `entity` — the derived system). Same field rules as the aggregate query. */
  query?: AnalyticsQuery;
  /** Only intervals overlapping the window (overlap-filtered, not clipped). */
  window?: AnalyticsWindow;
  select?: {
    columns?: GroupableColumn[];
    facets?: string[];
  };
  /** Statuses considered live. Default ['pending']. */
  liveStatuses?: string[];
  /**
   * Interval ordering by start instant. Default 'asc' (the journey read
   * top-down); 'desc' + `before` pages a long history recent-first.
   */
  order?: 'asc' | 'desc';
  /** Strict upper bound on startedAt — the "load earlier" cursor. */
  before?: Date | string;
  limit?: number;
}

export interface TimelineInterval {
  role: string;
  subtype?: string;
  status?: string;
  facets: Record<string, string | null>;
  /** created_at, ISO-8601 UTC. */
  startedAt: string;
  /** Instant the row left the live set; null = still open. */
  endedAt: string | null;
  /** To endedAt, else to window.to clamped at now. */
  durationSeconds: number;
}

export interface TimelineByFacetResult {
  intervals: TimelineInterval[];
  overflow: boolean;
}
