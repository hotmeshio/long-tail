/**
 * Universal identity context available to any tool/activity,
 * regardless of invocation path (MCP server, proxy activity, direct worker).
 *
 * Converges the three identity paths:
 * - MCP Server Tool: `args._auth` injection
 * - Proxy Activity: `OrchestratorContext` via AsyncLocalStorage
 * - YAML Worker: (previously no identity)
 *
 * Activities call `getToolContext()` to access identity without
 * knowing how they were invoked.
 */

/**
 * The principal (human user or bot) on whose behalf a tool runs.
 */
export interface ToolPrincipal {
  /** User or bot account ID (from lt_users). */
  id: string;
  /** 'user' for human accounts, 'bot' for service accounts. */
  type: 'user' | 'bot';
  /** Display name (for audit logs). */
  displayName?: string;
  /** RBAC role names from lt_user_roles. */
  roles: string[];
  /** Highest role type (superadmin > admin > member). */
  roleType?: string;
}

/**
 * Resolved credentials and scopes for this invocation.
 */
export interface ToolCredentials {
  /** Short-lived delegation token scoped to this invocation. */
  delegationToken?: string;
  /** Scopes granted for this invocation. */
  scopes: string[];
}

/**
 * Trace metadata for audit logging and lineage tracking.
 */
export interface ToolTrace {
  /** Root workflow that initiated the chain. */
  originId?: string;
  /** Immediate parent workflow. */
  parentId?: string;
  /** Current workflow ID. */
  workflowId?: string;
  /** OpenTelemetry trace ID. */
  traceId?: string;
  /** OpenTelemetry span ID. */
  spanId?: string;
}

/**
 * Universal tool/activity identity context.
 *
 * Available via `getToolContext()` from `services/iam/context`.
 */
export interface ToolContext {
  /** WHO — the authenticated principal (user or bot). */
  principal: ToolPrincipal;
  /** WHAT — credentials and scopes for this invocation. */
  credentials: ToolCredentials;
  /** WHERE — position in the workflow chain. */
  trace: ToolTrace;
}
