/** Type definitions for the role and escalation chain service. */

export interface EscalationChain {
  source_role: string;
  target_role: string;
}

/**
 * Reserved keys inside `lt_roles.properties`. Everything else in the bag is
 * user-owned. Readers type-guard (the bag is open, PATCH can write anything).
 *
 *  - ON_CANCEL: what cancel MEANS for this row class, imperative
 *    (e.g. "reset — the dispatcher re-mints the attempt").
 *  - ON_TIMEOUT: expiry semantics for this row class.
 *  - WORKED_BY: who works this queue ("humans at the dashboard" | "machines" | "both").
 *  - KIOSK: boolean — the locked station viewport. When a signed-in user is a
 *    MEMBER of exactly this one role, the dashboard drops the left nav, the
 *    role's escalation list becomes home, and navigation is held to the list,
 *    the detail page, and the scan screens. Multi-role users get full chrome.
 *  - LINK_VARIABLES: RoleLinkVariable[] — metadata facet names members bind
 *    per device. Pins may reference `{lt:name}` as a whole facet value
 *    (e.g. `facets={"region":"{lt:region}"}`); the dashboard substitutes
 *    the device's bound value at render time, falls back to the declared
 *    default, and drops the facet entirely when both are unset.
 */
export const ROLE_PROPERTY_KEYS = {
  ON_CANCEL: 'on_cancel',
  ON_TIMEOUT: 'on_timeout',
  WORKED_BY: 'worked_by',
  KIOSK: 'kiosk',
  LINK_VARIABLES: 'link_variables',
} as const;

/**
 * One link-variable declaration inside `properties.link_variables`. `name` is
 * the metadata facet key (facet-key charset); `label` is the human annotation
 * the binding modal shows; `default` is the value used when the device has no
 * binding. Values are strings — jsonb containment is type-sensitive, so
 * numeric facets are not templatable.
 */
export interface RoleLinkVariable {
  name: string;
  label?: string;
  default?: string;
}

export interface RoleDetail {
  role: string;
  title: string | null;
  description: string | null;
  /** JSON Schema for the escalation resolve FORM (the JIT UI). Versioned so the
   *  UI can evolve; fields may carry `x-lt-bind` to map form values to a path in
   *  the resolver payload the workflow consumes. */
  form_schema: Record<string, any> | null;
  /**
   * JSON Schema declaring the expected shape of lt_escalations.metadata for
   * escalations created under this role. Drives faceted-query key autocomplete
   * and creation-time metadata validation.
   */
  metadata_schema: Record<string, any> | null;
  /** Free-form user-owned bag (icons, colors, tags, …), plus the reserved
   *  domain-semantics keys in ROLE_PROPERTY_KEYS (on_cancel, on_timeout, worked_by). */
  properties: Record<string, any>;
  ops_visible: boolean;
  /**
   * Marks this role's sequence as the HOME page's default Pace Board segment.
   * Single-holder: setting it on one role clears it everywhere else. Only
   * meaningful while ops_visible is on; unset anywhere → the home board shows
   * the primary (first) segment.
   */
  ops_home_default: boolean;
  parent_role: string | null;
  /** Target resolution time (minutes). Part of the ops triangle. */
  sla_minutes: number | null;
  /** Intended throughput (items per hour). Part of the ops triangle. */
  target_per_hour: number | null;
  /** Capacity at this station (people or machines). Part of the ops triangle. */
  worker_count: number | null;
  /**
   * Max age (minutes) before a pending, unclaimed escalation counts toward the
   * Pace Board priority count. Falls back to sla_minutes when null.
   */
  priority_threshold_minutes: number | null;
  /**
   * lt_escalations.metadata key holding the age origin for the priority count
   * as an ISO 8601 UTC timestamp (e.g. the order's authorized date). Falls
   * back to created_at when null. When set, items missing the key or holding
   * an unparseable value are not counted.
   */
  priority_facet: string | null;
  /**
   * lt_escalations.metadata key identifying the ENTITY that moves through
   * this role (e.g. serialNumber, orderId). Powers the analytics surfaces —
   * distinct-entity counts, per-entity dwell, entity timelines. Null = the
   * role has no entity notion.
   */
  entity_facet: string | null;
  /**
   * How this role names its contribution to the entity's state space:
   * 'role' (the station itself is the state) or 'subtype' (the role's
   * subtypes are its states). Only meaningful while entity_facet is set.
   */
  entity_state_source: 'role' | 'subtype';
  /**
   * Version of the live form_schema. Advances whenever the form (or
   * metadata_schema) changes; each version is snapshotted in lt_role_schemas so
   * an escalation can pin the exact form it was created against. Null until the
   * role first carries a schema.
   */
  current_schema_version: number | null;
  /**
   * JSON contract (x-lt-* markup) that richly formats the escalation LIST page
   * when it is scoped to just this role. Opt-in and versioned INDEPENDENTLY of
   * form_schema — a display template, always rendered at its latest version.
   */
  list_schema: Record<string, any> | null;
  /** Version of the live list_schema; null until the role first carries one. */
  current_list_schema_version: number | null;
  /**
   * When true, every resolve surface validates the submitted resolverPayload
   * against the escalation's resolved form schema (same pass the dashboard
   * runs) and rejects violations with 422 before any state changes. Opt-in
   * per role; false leaves resolution behavior unchanged.
   */
  enforce_schema: boolean;
  /**
   * Pinned-view seeds this role hands its members: [{ label, url, badge? }].
   * On first render, a member without an own pin of the same label sees these
   * in their Pinned nav section (marked role-provided); users promote, hide,
   * or reorder them through their own preferences. URLs only — never data.
   */
  default_pins: { label: string; url: string; badge?: boolean }[] | null;
  /**
   * Roles this station draws input from that live in OTHER sequences.
   * parent_role is the single "prior step" placing the role in one sequence;
   * upstream inputs are the remaining graph edges (mixin-like, many allowed),
   * rendered on the Operations chart as a merge affordance.
   */
  upstream_roles: string[];
  user_count: number;
  chain_count: number;
  workflow_count: number;
}

/** One immutable snapshot of a role's schema set (form + metadata). */
export interface RoleSchemaVersion {
  role: string;
  version: number | null;
  form_schema: Record<string, any> | null;
  metadata_schema: Record<string, any> | null;
  change_summary: string | null;
  created_at: string | null;
  /** The role's current version, so callers can tell a pinned read from the latest. */
  latest_version: number | null;
}

/** Listing row for the version history (schemas elided; presence flags only). */
export interface RoleSchemaVersionSummary {
  version: number;
  has_form_schema: boolean;
  has_metadata_schema: boolean;
  change_summary: string | null;
  created_at: string;
  is_current: boolean;
}

/** One immutable snapshot of a role's LIST schema (independent version lineage). */
export interface RoleListSchemaVersion {
  role: string;
  version: number | null;
  list_schema: Record<string, any> | null;
  change_summary: string | null;
  created_at: string | null;
  latest_version: number | null;
}

/** Listing row for the list-schema version history (schema elided). */
export interface RoleListSchemaVersionSummary {
  version: number;
  has_list_schema: boolean;
  change_summary: string | null;
  created_at: string;
  is_current: boolean;
}

export interface UpdateRoleInput {
  title?: string | null;
  description?: string | null;
  form_schema?: Record<string, any> | null;
  metadata_schema?: Record<string, any> | null;
  /** JSON contract that richly formats this role's escalation list page. */
  list_schema?: Record<string, any> | null;
  default_pins?: { label: string; url: string; badge?: boolean }[] | null;
  properties?: Record<string, any> | null;
  ops_visible?: boolean;
  /** Make this role's sequence the home Pace Board's default segment (single-holder). */
  ops_home_default?: boolean;
  parent_role?: string | null;
  sla_minutes?: number | null;
  target_per_hour?: number | null;
  worker_count?: number | null;
  priority_threshold_minutes?: number | null;
  priority_facet?: string | null;
  entity_facet?: string | null;
  /** 'role' | 'subtype' — null resets to the 'role' default. */
  entity_state_source?: 'role' | 'subtype' | null;
  /** Turn server-side resolver schema validation on/off for this role. */
  enforce_schema?: boolean;
  /**
   * Replace the upstream-input set (omitted = preserve; null or [] = clear).
   * Every entry must name an existing role other than this one.
   */
  upstream_roles?: string[] | null;
  /** Recorded on the schema snapshot when this update changes a schema field. */
  change_summary?: string;
}
