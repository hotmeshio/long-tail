// ─── Faceted queue access ────────────────────────────────────────────────────
//
// General primitives for querying and atomically claiming work from the
// escalation queue by its BSON facets. The escalation `role` is the hard
// isolation boundary; `metadata` carries the facets a late-binding actor
// queries, sorts, and claims by. This is platform surface — what a unit's facets
// *mean* and how they map to capability/priority is the consuming app's policy
// (see examples/), never enumerated here.

export type FacetRangeOp = '<' | '<=' | '>' | '>=' | '=';

/** Numeric range over a metadata facet, e.g. (metadata->>'size')::numeric <= 13. */
export interface FacetRange {
  facet: string;
  op: FacetRangeOp;
  value: number;
}

/**
 * One sort key. `field` is either a whitelisted top-level column (`priority`,
 * `created_at`, `updated_at`, `status`, `role`) or a metadata path written as
 * `metadata.<key>` (extracted as text, or numeric when `numeric` is set).
 */
export interface FacetOrder {
  field: string;
  direction?: 'asc' | 'desc';
  numeric?: boolean;
}

/**
 * Composable faceted query over the queue — top-level columns and metadata BSON
 * facets, uniformly filterable and sortable. The actor decides what matters.
 */
export interface FacetQuery {
  role?: string;
  roles?: string[];
  /** metadata @> facets — required facets (AND), GIN-served. */
  facets?: Record<string, any>;
  /** NOT (metadata @> ANY(block)) — exclude units carrying any of these facet sets. */
  block?: Record<string, any>[];
  /** Numeric range predicates over metadata facets. */
  range?: FacetRange[];
  /** metadata ? key — facet must be present. */
  exists?: string[];
  status?: string;
  /** true = only available (unclaimed/expired); false = only held now. */
  available?: boolean;
  orderBy?: FacetOrder[];
  limit?: number;
  offset?: number;
}

/** Result of an atomic group claim — all members of one order (origin), or empty. */
export interface ClaimedGroup {
  originId: string | null;
  members: import('./escalation').LTEscalationRecord[];
}

/**
 * The pond viewed as orders/units — what a batched catch-and-release optimizer
 * reads to pack work into a consumer's capacity. `orderSize` is the declared
 * unit count (capacity this order needs); `available`/`complete` say whether it
 * is claimable now. Member-facet aggregates support optimizer scoring without
 * pulling every member.
 */
export interface GroupSummary {
  originId: string;
  memberCount: number;
  orderSize: number | null;
  available: boolean;
  complete: boolean;
  minPriority: number;
  createdAt: Date;
}
