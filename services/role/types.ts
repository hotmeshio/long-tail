/** Type definitions for the role and escalation chain service. */

export interface EscalationChain {
  source_role: string;
  target_role: string;
}

export interface RoleDetail {
  role: string;
  title: string | null;
  description: string | null;
  /** JSON Schema for the escalation resolve form. Overridden per-workflow by resolver_schema. */
  form_schema: Record<string, any> | null;
  /**
   * JSON Schema declaring the expected shape of lt_escalations.metadata for
   * escalations created under this role. Drives faceted-query key autocomplete
   * and creation-time metadata validation.
   */
  metadata_schema: Record<string, any> | null;
  /** Free-form user-owned bag. No reserved keys — use for icons, colors, tags, etc. */
  properties: Record<string, any>;
  ops_visible: boolean;
  parent_role: string | null;
  /** Target resolution time (minutes). Part of the ops triangle. */
  sla_minutes: number | null;
  /** Intended throughput (items per hour). Part of the ops triangle. */
  target_per_hour: number | null;
  /** Capacity at this station (people or machines). Part of the ops triangle. */
  worker_count: number | null;
  /**
   * Version of the live form_schema/metadata_schema pair. Advances whenever a
   * schema field changes; each version is snapshotted in lt_role_schemas so
   * escalations can pin the exact schema they were created against. Null until
   * the role first carries a schema.
   */
  current_schema_version: number | null;
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

/** One immutable snapshot of a role's schema pair. */
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

export interface UpdateRoleInput {
  title?: string | null;
  description?: string | null;
  form_schema?: Record<string, any> | null;
  metadata_schema?: Record<string, any> | null;
  properties?: Record<string, any> | null;
  ops_visible?: boolean;
  parent_role?: string | null;
  sla_minutes?: number | null;
  target_per_hour?: number | null;
  worker_count?: number | null;
  /**
   * Replace the upstream-input set (omitted = preserve; null or [] = clear).
   * Every entry must name an existing role other than this one.
   */
  upstream_roles?: string[] | null;
  /** Recorded on the schema snapshot when this update changes a schema field. */
  change_summary?: string;
}
