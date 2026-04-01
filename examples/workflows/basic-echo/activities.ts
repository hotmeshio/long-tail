/**
 * Basic Echo Activities
 *
 * Single activity that echoes a message back with IAM context.
 * Demonstrates two ways to access identity inside a proxy activity:
 *
 * 1. `getToolContext()` — convenience wrapper (checks argumentMetadata first)
 * 2. `Durable.activity.getContext()` — direct HotMesh API for argumentMetadata
 *
 * Both work across process boundaries because argumentMetadata travels
 * with the activity call via HotMesh's schema pipeline.
 */

import { Durable } from '@hotmeshio/hotmesh';

import { getToolContext } from '../../../services/iam/context';

export async function echo(input: {
  message: string;
}): Promise<{
  message: string;
  echoedAt: string;
  identity: Record<string, unknown>;
}> {
  // Primary: getToolContext() reads from argumentMetadata (injected by activity interceptor)
  const ctx = getToolContext();

  // Direct access: Durable.activity.getContext() shows the raw argumentMetadata
  const activityCtx = Durable.activity.getContext();
  const rawPrincipal = activityCtx?.argumentMetadata?.principal;

  const identity: Record<string, unknown> = ctx
    ? {
        source: 'envelope',
        principal: {
          id: ctx.principal.id,
          type: ctx.principal.type,
          displayName: ctx.principal.displayName,
          roles: ctx.principal.roles,
          roleType: ctx.principal.roleType,
        },
        scopes: ctx.credentials.scopes,
      }
    : rawPrincipal
      ? {
          source: 'argumentMetadata',
          principal: rawPrincipal,
        }
      : {
          source: 'unavailable',
          note: 'no principal in envelope or argumentMetadata',
        };

  return {
    message: input.message,
    echoedAt: new Date().toISOString(),
    identity,
  };
}
