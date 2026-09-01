/**
 * Batch Fanout — a parent orchestrates N children through the escalation
 * channel with ONE wait, no executeChild coupling.
 *
 * Parent:
 *   1. `startChild` × 3 — fire-and-forget spawns; only the starts are
 *      awaited, so the parent's footprint is three enqueues, not three
 *      held child results.
 *   2. Parks ONE batch accumulator: `conditional({ batch: [childKeys] })`.
 *      The row declares every expected item; the parent sleeps until the
 *      LAST item lands and receives the full collection.
 *
 * Child:
 *   1. Parks its OWN escalation — a normal queue item a person resolves in
 *      the dashboard with the standard form.
 *   2. On resume, calls home: `resolveBatchItem` fills the parent's batch
 *      row, as the person who resolved the child ($resolution provenance).
 *      The call-home activity retries on 404, covering the distributed race
 *      where a child resolves before the parent's batch row is parked.
 *
 * Interim fills are cheap row updates — the parent never wakes per child.
 * The completing fill resolves the parent's row and delivers the collection
 * in the same atomic statement.
 */

import { Durable } from '@hotmeshio/hotmesh';

import { conditional } from '../../../services/orchestrator/condition';
import { JOB_EXPIRE_SECS } from '../../../modules/defaults';
import type { LTEnvelope } from '../../../types';
import type { EscalationResolution } from '../../../types/escalation';

import * as activities from './activities';
import { FANOUT_HOME_FACET, type FanoutChildReport } from './activities';

type ActivitiesType = typeof activities;

const TASK_QUEUE = 'long-tail-examples';
const CHILD_WORKFLOW = 'batchFanoutChild';

export const FANOUT_CHILD_KEYS = ['prep', 'build', 'inspect'] as const;
export type FanoutChildKey = (typeof FANOUT_CHILD_KEYS)[number];

type FanoutCollection = Record<FanoutChildKey, FanoutChildReport> & {
  $resolution?: EscalationResolution;
};

interface FanoutEnvelopeData {
  orderId?: string;
  role?: string;
  message?: string;
}

export async function batchFanout(envelope: LTEnvelope): Promise<any> {
  const {
    orderId = 'order-1',
    role = 'reviewer',
    message = 'Each child parks its own item; resolve all three and the parent resumes.',
  } = (envelope.data ?? {}) as FanoutEnvelopeData;

  const ctx = Durable.workflow.workflowInfo();
  const homeSignalId = `fanout-home-${ctx.workflowId}`;

  // 1. Spawn — startChild only. Each child learns its item key and the
  // home signal; the parent holds no child handles and awaits no results.
  const childIds: string[] = [];
  for (const itemKey of FANOUT_CHILD_KEYS) {
    const childId = await Durable.workflow.startChild({
      workflowName: CHILD_WORKFLOW,
      args: [{
        data: { orderId, role, itemKey, homeSignalId },
        metadata: { source: 'batch-fanout', ...(envelope.metadata?.certified === true ? { certified: true } : {}) },
      }],
      taskQueue: TASK_QUEUE,
      workflowId: `${ctx.workflowId}-${itemKey}`,
      expire: JOB_EXPIRE_SECS,
      entity: CHILD_WORKFLOW,
      signalIn: false,
    });
    childIds.push(childId);
  }
  if (childIds.some((id) => !id)) {
    throw new Error('batchFanout: a child failed to start');
  }

  // 2. Park the accumulator — one wait for the whole fan-out. The home
  // facet lets children address this row without knowing its UUID.
  const results = await conditional<FanoutCollection>(homeSignalId, {
    role,
    type: 'batch-fanout',
    subtype: 'accumulator',
    priority: 2,
    description: `${message} (resolves automatically as children call home)`,
    workflowType: 'batchFanout',
    metadata: { orderId, [FANOUT_HOME_FACET]: homeSignalId },
    envelope: { data: envelope.data },
    batch: [...FANOUT_CHILD_KEYS],
    timeout: '24h',
  });

  if (results === false) {
    return { type: 'return' as const, data: { completed: false, reason: 'sla-expired', childIds } };
  }
  if (results === null) {
    return { type: 'return' as const, data: { completed: false, reason: 'cancelled', childIds } };
  }

  return {
    type: 'return' as const,
    data: {
      completed: true,
      childIds,
      children: {
        prep: results.prep,
        build: results.build,
        inspect: results.inspect,
      },
      allOk: FANOUT_CHILD_KEYS.every((k) => results[k]?.ok === true),
      // The completing fill's provenance — whoever resolved the LAST child.
      completedBy: results.$resolution?.resolvedBy ?? null,
    },
  };
}

interface FanoutChildEnvelopeData {
  orderId: string;
  role: string;
  itemKey: FanoutChildKey;
  homeSignalId: string;
}

interface FanoutChildResolver {
  ok?: boolean;
  notes?: string;
  $resolution?: EscalationResolution;
}

export async function batchFanoutChild(envelope: LTEnvelope): Promise<any> {
  const { orderId, role, itemKey, homeSignalId } =
    envelope.data as unknown as FanoutChildEnvelopeData;

  const { callHome } = Durable.workflow.proxyActivities<ActivitiesType>({
    activities,
    // Covers the distributed race: a child resolved before the parent's
    // batch row is parked retries until the accumulator exists.
    retry: { maximumAttempts: 12, backoffCoefficient: 2, maximumInterval: '30s' },
  });

  const ctx = Durable.workflow.workflowInfo();

  // 1. Park this child's own escalation — a standard dashboard queue item.
  const decision = await conditional<FanoutChildResolver>(`fanout-item-${ctx.workflowId}`, {
    role,
    type: 'batch-fanout-item',
    subtype: itemKey,
    priority: 2,
    description: `Fanout item "${itemKey}" for ${orderId} — resolving this calls home to the parent accumulator`,
    workflowType: CHILD_WORKFLOW,
    metadata: { orderId, itemKey },
    envelope: { data: { orderId, itemKey } },
    timeout: '24h',
  });

  // 2. Call home with this item's report. Terminal waits still report —
  // the parent's collection carries the reason instead of a payload.
  const report: FanoutChildReport =
    decision === false ? { ok: false, reason: 'sla-expired' }
      : decision === null ? { ok: false, reason: 'cancelled' }
        : { ok: decision.ok === true, ...(decision.notes ? { notes: decision.notes } : {}) };

  const outcome = await callHome({
    homeSignalId,
    itemKey,
    report,
    // The person who resolved this child submits the batch item — RBAC and
    // provenance follow them all the way to the parent's collection.
    actorId: (decision && decision.$resolution?.resolvedBy) || undefined,
  });

  return { type: 'return' as const, data: { itemKey, report, callHome: outcome } };
}
