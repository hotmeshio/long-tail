/**
 * printerTwin — the digital twin of one physical machine, as a poll-driven
 * reconciliation loop. Each link runs a bounded number of ~60s poll/reconcile
 * batches (the hot loop lives inside the pollReconcileBatch activity — zero
 * durable cost per poll), then continues the chain via startChild with an
 * incremented link counter. No Durable.sleep, no continueAsNew: the twin's
 * durable history is bounded per link, and the canonical `mirror` rides the
 * envelope from link to link.
 *
 * The mirror is the source of truth the twin keeps in sync with the machine;
 * every divergence that needs a decision (onboard, change filament, inspect a
 * failure, investigate an offline machine, retire) surfaces as an escalation the
 * twin opens and waits on. See ../mirror.ts, ../reconcile.ts, and the DIGITAL
 * twin spec.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../../types';

import { pollReconcileBatch } from './proxy';
import { TWIN_QUEUE, TWIN_WORKFLOWS } from '../types';
import type { TwinData, TwinResult } from '../types';

/** Batches per link before startChild bounds the replay history. Tunable for tests. */
const BATCHES_PER_LINK = Number(process.env.TWIN_BATCHES_PER_LINK ?? 25);
/** How long a completed link's state lingers (cleanup horizon, seconds). */
const LINK_EXPIRE = Number(process.env.TWIN_LINK_EXPIRE ?? 3600);

export async function printerTwin(envelope: LTEnvelope): Promise<any> {
  const d = (envelope.data ?? {}) as TwinData;
  if (!d.printerId) throw new Error('printerTwin requires data.printerId');
  if (!d.operatorId) throw new Error('printerTwin requires data.operatorId (a fleet pond operator)');
  const ctx = Durable.workflow.workflowInfo();
  const link = d.link ?? 0;

  let mirror = d.mirror; // undefined on the first link — the activity bootstraps it

  for (let i = 0; i < BATCHES_PER_LINK; i++) {
    const res = await pollReconcileBatch({
      mirror,
      printerId: d.printerId,
      link,
      operatorId: d.operatorId,
      workflowId: ctx.workflowId,
    });
    mirror = res.mirror;

    // End of life — the asset retires; its whole story is its escalation trail.
    if (mirror.phase === 'retired') {
      const result: TwinResult = { printerId: d.printerId, retired: true, jobsCompleted: mirror.jobsCompleted, services: mirror.services };
      return { type: 'return' as const, data: result };
    }
  }

  // Continue the chain — the next link picks up the mirror exactly where we left it.
  const nextLink = link + 1;
  await Durable.workflow.startChild({
    taskQueue: TWIN_QUEUE,
    workflowName: TWIN_WORKFLOWS.TWIN,
    workflowId: `${d.printerId}-l${nextLink}`,
    args: [{ data: { ...d, mirror, link: nextLink }, metadata: envelope.metadata ?? {} }],
    expire: LINK_EXPIRE,
  });

  return { type: 'return' as const, data: { printerId: d.printerId, link, next: `${d.printerId}-l${nextLink}` } };
}
