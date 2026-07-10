/**
 * Full workflow configuration as stored in the database.
 * Includes all sub-entities (roles, consumers).
 */
export interface LTWorkflowConfig {
  workflow_type: string;
  invocable: boolean;
  /**
   * Explicit certification. Certified workflows get the interceptor: task
   * tracking, escalation handling, re-run detection. Stored on the row —
   * demoting to plain registered flips this flag and keeps every other
   * field intact. Always present on reads; optional on writes, where an
   * omitted value derives from roles/consumes presence (the pre-flag rule).
   */
  certified?: boolean;
  task_queue: string | null;
  default_role: string;
  description: string | null;
  /**
   * @deprecated Escalation formalization belongs to the escalation and its
   * role — roles carry the versioned escalation schema and take precedence.
   * This list remains only as the interceptor default for who can claim and
   * resolve interceptor-raised escalations.
   */
  roles: string[];
  invocation_roles: string[];
  consumes: string[];
  tool_tags?: string[];
  envelope_schema?: Record<string, any> | null;
  /** @deprecated The escalation form is a versioned, role-owned schema. Legacy fallback only. */
  resolver_schema?: Record<string, any> | null;
  cron_schedule?: string | null;
  /** Bot external_id to run as. When set, workflows use this bot's identity. */
  execute_as?: string | null;
}

/**
 * Resolved config used by interceptor/executeLT at runtime.
 * Flat structure with camelCase keys — no DB row noise.
 */
export interface LTResolvedConfig {
  invocable: boolean;
  /** Explicit certification — gates the interceptor treatment. */
  certified: boolean;
  taskQueue: string | null;
  role: string;
  roles: string[];
  invocationRoles: string[];
  consumes: string[];
  toolTags: string[];
  envelopeSchema: Record<string, any> | null;
  /** @deprecated Role-owned versioned schema supersedes this. Legacy fallback only. */
  resolverSchema: Record<string, any> | null;
  cronSchedule: string | null;
  executeAs: string | null;
}

/**
 * Provider data returned by ltGetProviderData.
 * Keyed by workflow type name from the `consumes` array.
 */
export interface LTProviderData {
  [providerName: string]: {
    data: Record<string, any>;
    completedAt: string;
    workflowType: string;
  };
}
