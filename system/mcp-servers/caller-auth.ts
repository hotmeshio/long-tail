import { ensureSystemBot } from '../../services/iam';
import type { LTApiAuth } from '../../types/sdk';

/** The `extra` argument the MCP SDK passes to a tool handler. */
export interface ToolCallExtra {
  authInfo?: unknown;
}

let systemPrincipalId: string | null = null;

/**
 * The lt-system bot as an api principal. The escalation RBAC helpers query a
 * uuid column, so the bot's real UUID is resolved once and cached rather than
 * passing its external_id. The bot is a superadmin.
 */
export async function systemAuth(): Promise<LTApiAuth> {
  if (!systemPrincipalId) systemPrincipalId = await ensureSystemBot();
  return { userId: systemPrincipalId, role: 'superadmin' };
}

/**
 * The authenticated caller when the call arrived at `/mcp`. The SDK forwards
 * `req.auth` as `authInfo`; internal dispatch passes no `extra`.
 */
export function externalCaller(extra?: ToolCallExtra): LTApiAuth | undefined {
  const auth = extra?.authInfo as LTApiAuth | undefined;
  return auth?.userId ? auth : undefined;
}

/** The external caller, or the lt-system principal for internal calls. */
export async function callerAuth(extra?: ToolCallExtra): Promise<LTApiAuth> {
  return externalCaller(extra) ?? systemAuth();
}
