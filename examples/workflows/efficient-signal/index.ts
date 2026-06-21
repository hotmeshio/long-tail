/**
 * Efficient Signal Workflow — the 0.22.x atomic-escalation variant of
 * `basic-signal`. Same human-in-the-loop UX, fewer moving parts.
 *
 * Legacy (`basic-signal`):
 *   1. `ltCreateEscalation(...)`        ← separate proxyActivity round-trip
 *   2. `conditionLT(signalId)`          ← waits; on resume runs ltResolveEscalation
 *
 * Efficient (this workflow):
 *   1. `condition(signalId, queueConfig)` ← writes the escalation row inside the
 *      workflow's Leg1 checkpoint (one atomic commit — crash-safe, no create
 *      activity, no enrich) AND suspends. `client.escalations.resolve()` marks it
 *      resolved, delivers the signal, and resumes THIS job in place (no re-run).
 *      Fires `system.escalation.{id}.created` automatically.
 *
 * Never replaces `basic-signal` — it sits beside it so the two can be compared.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';

export async function efficientSignal(envelope: LTEnvelope): Promise<any> {
  const { message = 'Please review and approve.', role = 'reviewer' } = envelope.data ?? {};

  const ctx = Durable.workflow.workflowInfo();
  const signalId = `approval-${ctx.workflowId}`;

  // One expression: atomic Leg1 escalation write + suspend.
  const decision = await Durable.workflow.condition<{ approved: boolean; notes?: string }>(
    signalId,
    {
      role,
      type: 'signal-approval',
      subtype: 'efficient',
      description: message,
      priority: 2,
      workflowType: 'efficientSignal',
      metadata: { efficient: true },
      envelope: { data: envelope.data },
    },
  );

  // `false` only if a timeout string had been supplied (it wasn't) — here the
  // signal always carries the resolver payload.
  if (decision === false) {
    return { type: 'return' as const, data: { approved: false, notes: 'no decision' } };
  }

  return {
    type: 'return' as const,
    data: { approved: decision.approved, notes: decision.notes ?? '' },
  };
}
