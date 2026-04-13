/**
 * Basic Echo Activities
 *
 * Single activity that echoes a message back with IAM context.
 * Demonstrates three ways to access identity inside a proxy activity:
 *
 * 1. `getActivityIdentity()` — recommended: one-call access to principal + credential exchange
 * 2. `getToolContext()` — lower-level access to ToolContext (principal, scopes, trace)
 * 3. `Durable.activity.getContext()` — raw HotMesh API for headers
 *
 * All work across process boundaries because headers travels
 * with the activity call via HotMesh's schema pipeline.
 */

import { Durable } from '@hotmeshio/hotmesh';

import { getActivityIdentity } from '../../../services/iam/activity';
import { getToolContext } from '../../../services/iam/context';

export async function echo(input: {
  message: string;
}): Promise<{
  message: string;
  echoedAt: string;
  identity: Record<string, unknown>;
}> {
  // Recommended: getActivityIdentity() — principal + getCredential() in one call
  // const identity = getActivityIdentity();
  // const token = await identity.getCredential('anthropic'); // credential exchange

  // Primary: getToolContext() reads from headers (injected by activity interceptor)
  const ctx = getToolContext();

  // Direct access: Durable.activity.getContext() shows the raw headers
  const activityCtx = Durable.activity.getContext();
  const rawPrincipal = activityCtx?.headers?.principal;

  const identity: Record<string, unknown> = ctx
    ? {
        source: 'getActivityIdentity',
        principal: {
          id: ctx.principal.id,
          type: ctx.principal.type,
          displayName: ctx.principal.displayName,
          roles: ctx.principal.roles,
          roleType: ctx.principal.roleType,
        },
        scopes: ctx.credentials.scopes,
        note: 'Also available via getActivityIdentity().getCredential(provider) for token exchange',
      }
    : rawPrincipal
      ? {
          source: 'headers',
          principal: rawPrincipal,
        }
      : {
          source: 'unavailable',
          note: 'no principal in envelope or headers',
        };

  return {
    message: input.message,
    echoedAt: new Date().toISOString(),
    identity,
  };
}
