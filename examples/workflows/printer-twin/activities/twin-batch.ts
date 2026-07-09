/**
 * pollReconcileBatch — the twin's hot loop as a single durable activity. Runs a
 * bounded (~60s) plain-JS loop of poll → reconcile → execute, pacing itself with
 * a plain setTimeout (fast while a command is unconfirmed, baseline otherwise).
 * One durable checkpoint per return, not one per poll — the two-cost-layers
 * pattern (see ../../print-routing/ARCHITECTURE.md). The workflow calls this K
 * times per link, then startChilds the next link. No Durable.sleep anywhere.
 */

import { createClient } from '../../../../sdk';

import { reconcile } from '../reconcile';
import { getBambuClient } from './bambu-client';
import { gatherObservation, executeActions } from './twin-execute';
import { freshMirror, type Mirror } from '../mirror';

// Example-friendly defaults for a responsive demo. Production overrides these
// via env (e.g. TWIN_POLL_MS=20000, TWIN_BATCH_MS=60000) per DIGITAL_TWIN_SPEC's
// 15–30s baseline poll band.
const batchMs = (): number => Number(process.env.TWIN_BATCH_MS ?? 8_000);
const baselineMs = (): number => Number(process.env.TWIN_POLL_MS ?? 2_000);
const fastMs = (): number => Number(process.env.TWIN_FAST_POLL_MS ?? 1_000);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function pollReconcileBatch(input: {
  /** Undefined on the first link — the activity bootstraps a fresh mirror. */
  mirror?: Mirror;
  printerId: string;
  link?: number;
  operatorId: string;
  workflowId: string;
}): Promise<{ mirror: Mirror }> {
  const client = getBambuClient();
  const lt = createClient({ auth: { userId: input.operatorId } });
  const deps = { lt, client, operatorId: input.operatorId, workflowId: input.workflowId };

  // Bootstrap the mirror here (not in the workflow) so all wall-clock stamps
  // originate in the activity — the workflow script never calls Date.now().
  let mirror = input.mirror ?? freshMirror(input.printerId, Date.now(), input.link ?? 0);
  const deadline = Date.now() + batchMs();

  for (;;) {
    const obs = await gatherObservation(mirror, deps);
    const result = reconcile(mirror, obs);
    mirror = result.mirror;
    await executeActions(mirror, result.actions, deps);

    if (mirror.phase === 'retired') break;

    const cadence = mirror.pendingCommand ? fastMs() : baselineMs();
    if (Date.now() + cadence >= deadline) break;
    await sleep(cadence);
  }

  return { mirror };
}
