import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Durable } from '@hotmeshio/hotmesh';

import * as escalationApi from '../../api/escalations';
import * as escalationService from '../../services/escalation';
import { lineSteps } from '../../examples/workflows/machine-line/workflows/route';
import { DECISION, HANDOFF_ERROR, signalKeys } from '../../services/machines/contracts';
import { machineRole, machineById } from '../../lib/machines/line';
import { OP } from '../../lib/machines/protocol';
import { eventually, startWorkflowRig, type WorkflowRig } from '../helpers/machine-line-workflow-rig';

// A cancelled handoff withdraws only the receiver's dispatch: a row commands
// the machine whose role it is on. Stopping the sender's job is this
// workflow's policy, through a cancel command row on the sender's role.

let rig: WorkflowRig;
beforeAll(async () => {
  rig = await startWorkflowRig({ taskQueue: 'test-machine-route-cancel' });
}, 60_000);
afterAll(async () => rig?.stop(), 20_000);

describe('machine unit route: a cancelled handoff', () => {
  it('stops the sender\'s job through a command row on its role, then asks the operator', async () => {
    rig.harness.line.config('press-01', { cycleSec: 5_000 });
    const routeKey = `R${Durable.guid().slice(0, 8)}`;
    const handle = await rig.start(routeKey, ['C1'], { steps: lineSteps(rig.line) });
    const senderJob = `${routeKey}-press-01`;
    const intoCut = await rig.rowBySignal(signalKeys.handoff(routeKey, 1, 1), 30_000);
    await eventually(async () => rig.harness.line.machine('press-01').cell.jobs.get(senderJob)?.status === 'running');

    await escalationService.cancelEscalation(intoCut.id);
    const stop = await rig.rowBySignal(signalKeys.jobStop(routeKey, 1, 1), 30_000);
    expect(stop).toMatchObject({ type: 'machine-command', subtype: OP.CANCEL, role: machineRole(machineById(rig.line, 'press-01')) });
    expect((stop.metadata as any).args).toEqual({ jobId: senderJob });
    await eventually(async () => rig.harness.line.machine('press-01').cell.jobs.get(senderJob)?.status === 'done');

    const decide = await rig.rowBySignal(signalKeys.handoffError(routeKey, 1, 1), 30_000);
    expect(decide).toMatchObject({ subtype: HANDOFF_ERROR.CANCELLED });
    expect((await escalationApi.resolveEscalation({ id: decide.id, resolverPayload: { decision: DECISION.SCRAP, note: 'cancelled' } }, { userId: rig.personId })).status).toBe(200);
    expect((await handle.result() as { data: Record<string, any> }).data).toMatchObject({ status: 'scrapped', at: 'press-01' });
    await eventually(() => rig.harness.line.unload('press-01', { unitId: 'C1' }));
  }, 90_000);
});
