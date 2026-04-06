/**
 * Build a ToolContext from the envelope's pre-resolved principal.
 *
 * Pure data transformation — no DB calls. The principal was resolved
 * at the front door (API route, cron, escalation re-run) and travels
 * with the envelope.
 */

import { createDelegationToken } from '../auth/delegation';
import type { LTEnvelope } from '../../types/envelope';
import type { ToolContext } from '../../types/tool-context';

export function buildToolContextFromEnvelope(
  envelope: LTEnvelope | undefined,
  workflowId?: string,
  traceId?: string,
  spanId?: string,
): ToolContext | null {
  const principal = envelope?.lt?.principal;
  if (!principal) return null;

  const scopes = envelope.lt?.scopes ?? ['mcp:tool:call'];
  const delegationToken = createDelegationToken(
    principal.id,
    scopes,
    300,
    { workflowId },
  );

  return {
    principal,
    ...(envelope.lt?.initiatingPrincipal
      ? { initiatingPrincipal: envelope.lt.initiatingPrincipal }
      : {}),
    credentials: { delegationToken, scopes },
    trace: {
      originId: envelope.lt?.originId,
      parentId: envelope.lt?.parentId,
      workflowId,
      traceId,
      spanId,
    },
  };
}
