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
  user_count: number;
  chain_count: number;
  workflow_count: number;
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
}
