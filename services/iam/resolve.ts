/**
 * Resolves a ToolContext from whatever identity information is available.
 *
 * This is the single convergence point for all three invocation paths.
 * Each path calls `resolveToolContext()` with whatever identity data
 * it has, and gets back the same ToolContext shape.
 */
import type { LTEnvelope } from '../../types/envelope';
import type { ToolContext, ToolPrincipal, ToolCredentials, ToolTrace } from '../../types/tool-context';
import type { OrchestratorContext } from '../interceptor/types';

import { createDelegationToken } from '../auth/delegation';
import { getUser, getUserRoles } from '../user';
import { loggerRegistry } from '../../lib/logger';

/** Role type priority for determining highest role type. */
const ROLE_TYPE_PRIORITY: Record<string, number> = { superadmin: 3, admin: 2, member: 1 };

/**
 * Source data for resolving a ToolContext.
 * Callers pass whichever fields they have; resolution picks the best available.
 */
export interface ToolContextSource {
  /** Direct userId (e.g., from _auth injection or envelope). */
  userId?: string;
  /** Account type override (for known bot invocations). */
  accountType?: 'user' | 'bot';
  /** Existing delegation token to decode instead of minting new. */
  delegationToken?: string;
  /** Scopes for delegation token (defaults to ['mcp:tool:call']). */
  scopes?: string[];
  /** Envelope from workflow args. */
  envelope?: LTEnvelope;
  /** OrchestratorContext from AsyncLocalStorage. */
  orchestratorContext?: OrchestratorContext;
  /** _auth from MCP tool args. */
  _auth?: { userId?: string; token?: string };
  /** Trace IDs for audit lineage. */
  traceId?: string;
  spanId?: string;
}

/**
 * Resolve identity from any available source, load roles, mint delegation token.
 *
 * Resolution priority for userId:
 * 1. Explicit `_auth.userId` (MCP server tool path)
 * 2. Explicit `userId` parameter
 * 3. `envelope.lt.userId` (workflow/envelope path)
 * 4. `orchestratorContext.userId` (proxy activity path)
 *
 * Returns null when no identity can be resolved (anonymous/system context).
 */
export async function resolveToolContext(source: ToolContextSource): Promise<ToolContext | null> {
  // Resolve userId from available sources
  const userId =
    source._auth?.userId ||
    source.userId ||
    source.envelope?.lt?.userId ||
    source.orchestratorContext?.userId;

  if (!userId) {
    return null;
  }

  // Build principal with roles from DB
  const principal = await resolvePrincipal(userId, source.accountType);

  // Use existing delegation token or mint a new one
  const scopes = source.scopes ?? ['mcp:tool:call'];
  const delegationToken = source._auth?.token ?? source.delegationToken ?? createDelegationToken(
    userId,
    scopes,
    300,
    {
      workflowId: source.orchestratorContext?.workflowId ?? source.envelope?.lt?.parentWorkflowId,
    },
  );

  const credentials: ToolCredentials = {
    delegationToken,
    scopes,
  };

  // Build trace from envelope and orchestrator context
  const trace: ToolTrace = {
    originId: source.envelope?.lt?.originId,
    parentId: source.envelope?.lt?.parentId,
    workflowId: source.orchestratorContext?.workflowId,
    traceId: source.traceId,
    spanId: source.spanId,
  };

  return { principal, credentials, trace };
}

/**
 * Load a ToolPrincipal from the database.
 * Lightweight: one query for user + one for roles.
 */
async function resolvePrincipal(
  userId: string,
  accountType?: 'user' | 'bot',
): Promise<ToolPrincipal> {
  try {
    const [user, roles] = await Promise.all([
      getUser(userId),
      getUserRoles(userId),
    ]);

    // Determine highest role type
    let highestPriority = 0;
    let highestType: string | undefined;
    const roleNames: string[] = [];

    for (const r of roles) {
      roleNames.push(r.role);
      const priority = ROLE_TYPE_PRIORITY[r.type] ?? 0;
      if (priority > highestPriority) {
        highestPriority = priority;
        highestType = r.type;
      }
    }

    return {
      id: userId,
      type: accountType ?? (user?.metadata as any)?.account_type ?? 'user',
      displayName: user?.display_name ?? undefined,
      roles: roleNames,
      roleType: highestType,
    };
  } catch (err) {
    loggerRegistry.warn(`Failed to load principal for userId=${userId}: ${err}`);
    // Fallback: minimal principal with just the ID
    return {
      id: userId,
      type: accountType ?? 'user',
      roles: [],
    };
  }
}
