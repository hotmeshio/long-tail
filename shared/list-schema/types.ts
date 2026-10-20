/**
 * Related sets on a role's list schema. A set is named once under
 * `x-lt-related`; columns (`related`) and row details (`x-lt-row-detail`)
 * reference it by name. The server reads the declaration from the stored
 * list schema, never from the caller.
 *
 *   items  the host row's accumulated or batch items, each read through its
 *          payload or its reciprocal row
 *   query  rows in other roles that share facets with the host row; facet
 *          values are `{{domain.path}}` templates over the host row
 */

export const LIST_SCHEMA_KEYS = {
  RELATED: 'x-lt-related',
  COLUMNS: 'x-lt-columns',
  ROW_DETAIL: 'x-lt-row-detail',
  GROUP_BY: 'x-lt-group-by',
  LAYOUT: 'x-lt-layout',
} as const;

export const RELATED_SOURCES = {
  ITEMS: 'items',
  QUERY: 'query',
} as const;
export type RelatedSource = (typeof RELATED_SOURCES)[keyof typeof RELATED_SOURCES];

export const RELATED_AGGREGATES = {
  COUNT: 'count',
  /** The least item or row value: numbers as numbers, everything else as text. */
  MIN: 'min',
  MAX: 'max',
} as const;
export type RelatedAggregate = (typeof RELATED_AGGREGATES)[keyof typeof RELATED_AGGREGATES];

/** How a grouped table folds a plain column across a group's rows. */
export const GROUP_FOLDS = {
  FIRST: 'first',
  MIN: 'min',
  MAX: 'max',
  SUM: 'sum',
  COUNT: 'count',
  /** The distinct values, in row order, joined: "standard, express". */
  DISTINCT: 'distinct',
} as const;
export type GroupFold = (typeof GROUP_FOLDS)[keyof typeof GROUP_FOLDS];

/** Split prefixes. `role` splits a query set by the related row's role. */
export const SPLIT_PATHS = {
  ROLE: 'role',
  METADATA: 'metadata.',
  PAYLOAD: 'payload.',
  RECIPROCAL_METADATA: 'reciprocal.metadata.',
} as const;

export const RELATED_LIMITS = {
  MAX_SETS: 4,
  MAX_QUERY_ROLES: 12,
  MAX_ROW_DETAIL_SECTIONS: 4,
  MAX_HOSTS: 100,
  ROWS_DEFAULT: 25,
  ROWS_MAX: 100,
} as const;

/** The table layout that renders related columns, row details, and groups. */
export const FACET_TABLE_LAYOUT = 'facet-table';

export interface RelatedQueryDecl {
  /** Related roles, in display order. Exclusive with `segment`. */
  roles?: string[];
  /** A Pace Board sequence by its first role; resolves to the ordered chain. */
  segment?: string;
  /** Facet containment; string values may be `{{domain.path}}` templates. */
  facets?: Record<string, unknown>;
  /**
   * Facets that narrow the match when the host row carries a value, and
   * drop away when it does not: a lane narrows its tub's look-ahead to its
   * own service level, a tub without lanes keeps the whole destination.
   */
  narrow?: Record<string, unknown>;
  /** Default `pending`. */
  status?: string;
}

export interface RelatedSetDecl {
  source: RelatedSource;
  query?: RelatedQueryDecl;
}

/** A count column's text keyed by count; `default` covers the rest, `{n}` reads the count. */
export const RELATED_DISPLAY_DEFAULT = 'default';

export interface RelatedColumnDecl {
  label: string;
  related: string;
  aggregate?: RelatedAggregate;
  /** min/max: `{{item.payload.<path>}}` on an items set, `{{metadata.<key>}}` on a query set. */
  value?: string;
  /** min/max: how the value renders, as on any facet-table column. */
  format?: string;
  /** count: text by count, e.g. `{ "0": "Ready", "default": "Waiting on {n}" }`. */
  display?: Record<string, string>;
  splitBy?: string;
  labels?: Record<string, string>;
  priority?: 1 | 2 | 3;
  /** CSS width, as on any facet-table column. */
  width?: string;
}

export interface RowDetailColumnDecl {
  label: string;
  value: string;
  format?: string;
  priority?: 1 | 2 | 3;
}

export interface RowDetailSectionDecl {
  related: string;
  label?: string;
  columns: RowDetailColumnDecl[];
  limit?: number;
}

/** The validated, normalized related declaration of one list schema. */
export interface ListSchemaRelations {
  sets: Record<string, RelatedSetDecl>;
  columns: RelatedColumnDecl[];
  rowDetail: RowDetailSectionDecl[];
  /** The metadata key a facet-table groups by, when declared. */
  groupKey: string | null;
}

/** Per-host aggregate for one (set, splitBy) pair, or one (set, min/max, value) triple. */
export interface RelatedHostAggregate {
  count: number;
  /** min/max: the extreme value among `count` values; absent when none carries one. */
  value?: string | number;
  /** Split value to count; a null value is keyed by the empty string. */
  splits?: Record<string, number>;
  /** Items whose reciprocal row the viewer cannot read. */
  hidden?: number;
  /** A host whose facet templates resolved to nothing; the set did not run. */
  unresolved?: boolean;
}

export interface RelatedSetResult {
  source: RelatedSource;
  /**
   * The roles whose rows the set reads, which a list follows for live
   * changes: a query set's resolved roles in order, or the roles of an item
   * set's readable reciprocal rows when a column splits by them.
   */
  roles?: string[];
  /** Query sets: role titles, keyed by role. */
  roleLabels?: Record<string, string>;
  /** Query sets: declared roles outside the viewer's full read scope. */
  restricted?: string[];
  /** Keyed by relatedAggregateKey (the splitBy, '' when unsplit, or `min:<path>`), then host id. */
  aggregates: Record<string, Record<string, RelatedHostAggregate>>;
}

export interface RelatedAggregatesResponse {
  version: number | null;
  sets: Record<string, RelatedSetResult>;
}

export interface RelatedItemEntry {
  itemKey: string;
  payload?: unknown;
  at?: string;
  actor?: string;
  reciprocalId?: string;
}

export interface RelatedRow {
  /** Items sets only. */
  item?: RelatedItemEntry;
  /** The reciprocal row (items) or the related row (query); null when unreadable. */
  escalation: Record<string, unknown> | null;
}

export interface RelatedRowsResponse {
  source: RelatedSource;
  rows: RelatedRow[];
  total: number;
  restricted?: string[];
  roleLabels?: Record<string, string>;
}
