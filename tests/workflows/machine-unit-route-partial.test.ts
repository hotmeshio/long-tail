import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Durable } from '@hotmeshio/hotmesh';

import * as escalationApi from '../../api/escalations';
import { lineSteps } from '../../examples/workflows/machine-line/workflows/route';
import { DECISION, HANDOFF_ERROR, signalKeys } from '../../services/machines/contracts';
import { startWorkflowRig, type WorkflowRig } from '../helpers/machine-line-workflow-rig';

// A move that times out after only some of its units arrived leaves them split
// between two stations. A retry would ask the sender for units it no longer
// holds, so the operator row offers only manual and scrap.

let rig: WorkflowRig;
beforeAll(async () => {
  rig = await startWorkflowRig({ taskQueue: 'test-machine-route-partial' });
}, 60_000);
afterAll(async () => rig?.stop(), 20_000);

describe('machine unit route: a partial arrival', () => {
  it('one of two units stalls leaving the press: the operator row names the arrival and offers no retry', async () => {
    const routeKey = `R${Durable.guid().slice(0, 8)}`;
    rig.harness.line.armTransfer('press-01', { fault: 'stall' });
    const handle = await rig.start(routeKey, ['Q1', 'Q2'], { steps: lineSteps(rig.line), handoffTimeout: '8s' });

    const decide = await rig.rowBySignal(signalKeys.handoffError(routeKey, 1, 1), 30_000);
    expect(decide).toMatchObject({ role: 'line-operator', subtype: HANDOFF_ERROR.PARTIAL_ARRIVAL });
    expect((decide.metadata as any).decisions).toEqual([DECISION.MANUAL, DECISION.SCRAP]);
    expect((decide.metadata as any).detail).toMatch(/^Q[12] arrived; the rest did not before the timeout$/);

    const resolved = await escalationApi.resolveEscalation({ id: decide.id, resolverPayload: { decision: DECISION.SCRAP, note: 'split' } }, { userId: rig.personId });
    expect(resolved.status).toBe(200);
    const final = await handle.result() as { data: Record<string, any> };
    expect(final.data).toMatchObject({ status: 'scrapped', at: 'press-01', note: 'split' });
    expect(final.data.history.filter((h: any) => h.to === 'cut-01')).toEqual([
      expect.objectContaining({ attempt: 1, received: false, errorCode: HANDOFF_ERROR.PARTIAL_ARRIVAL }),
    ]);
  }, 90_000);
});
