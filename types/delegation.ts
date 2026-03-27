/**
 * Delegation token payload — a scoped, short-lived JWT authorizing
 * an MCP tool to act on behalf of a user.
 */
export interface DelegationTokenPayload {
  /** Token type discriminator (distinguishes from user session JWTs). */
  type: 'delegation';
  /** User ID (JWT `sub` claim). */
  sub: string;
  /** Allowed scopes (e.g. ['oauth:google:read', 'files:read']). */
  scopes: string[];
  /** Workflow that created this token (for audit). */
  workflowId?: string;
  /** Target MCP server this token is scoped to. */
  serverId?: string;
  /** Standard JWT claims (set by sign). */
  iss?: string;
  iat?: number;
  exp?: number;
}

/**
 * Auth context passed to MCP tool invocations.
 * Injected as `_auth` in tool args.
 */
export interface ToolAuthContext {
  userId?: string;
  delegationToken?: string;
}

/**
 * Service token database record.
 */
export interface ServiceTokenRecord {
  id: string;
  name: string;
  server_id: string | null;
  scopes: string[];
  expires_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
