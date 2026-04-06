/**
 * Identity and credential access for proxy activities.
 *
 * Activities call `getActivityIdentity()` to read the principal
 * injected by the activity interceptor and to resolve provider
 * credentials (OAuth tokens, API keys) via the credential cascade.
 *
 * @example Single-identity — activity runs as the invoking user or bot
 * ```typescript
 * import { getActivityIdentity } from '../services/iam/activity';
 *
 * export async function sendEmail(input: { to: string; body: string }) {
 *   const identity = getActivityIdentity();
 *   const gmailToken = await identity.getCredential('google');
 *   // identity.principal has id, type, roles, displayName
 * }
 * ```
 *
 * @example Dual-identity — bot executes but needs the invoking user's credential
 * ```typescript
 * export async function readUserMail(input: { query: string }) {
 *   const identity = getActivityIdentity();
 *   // getCredential checks the bot first, then falls back to the
 *   // human invoker's stored token (e.g., their Gmail OAuth)
 *   const gmailToken = await identity.getCredential('google');
 *   // identity.initiatingPrincipal has the human's profile
 * }
 * ```
 */

import { getToolContext } from './context';
import { resolveCredential, MissingCredentialError } from './credentials';
import type { ToolContext, ToolPrincipal } from '../../types/tool-context';

/** Identity and credential access returned by `getActivityIdentity()`. */
export interface ActivityIdentity {
  /** The executing principal (user or bot). */
  principal: ToolPrincipal;
  /** The original human invoker when proxy invocation is used (undefined if no proxy). */
  initiatingPrincipal?: ToolPrincipal;
  /** Scopes granted for this invocation (e.g., 'workflow:invoke'). */
  scopes: string[];
  /**
   * Resolve a provider credential via the credential cascade.
   * Tries: executing principal → initiating principal → system env var.
   * Throws MissingCredentialError if none found.
   */
  getCredential(provider: string, label?: string): Promise<string>;
  /** Full ToolContext (trace IDs, delegation token, etc.). */
  toolContext: ToolContext;
}

/**
 * Returns the identity context for the current proxy activity.
 * @throws Error if called outside an interceptor-wrapped activity.
 */
export function getActivityIdentity(): ActivityIdentity {
  const ctx = getToolContext();
  if (!ctx) {
    throw new Error(
      'No IAM context available. Is this running inside a proxy activity with the LT interceptor?',
    );
  }

  return {
    principal: ctx.principal,
    initiatingPrincipal: ctx.initiatingPrincipal,
    scopes: ctx.credentials.scopes,
    toolContext: ctx,
    async getCredential(provider: string, label?: string): Promise<string> {
      const resolved = await resolveCredential(ctx.principal, provider, label, {
        fallbackPrincipal: ctx.initiatingPrincipal,
      });
      if (!resolved) {
        throw new MissingCredentialError(provider);
      }
      return resolved.value;
    },
  };
}
