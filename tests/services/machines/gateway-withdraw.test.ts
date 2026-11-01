import { describe, it, expect, afterEach } from 'vitest';

import { CHANNEL, DISPATCH_ON, OP, buildEnvelope, genericCodec, machineTopic } from '../../../lib/machines/protocol';
import { identOf } from '../../../lib/machines/line';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { ROOT, sleep, until } from '../../helpers/machine-line-fixtures';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';

let rig: LineRig;
afterEach(async () => rig?.stop());

const cancels = (machineId: string) => rig.recorder.commands(machineId, OP.CANCEL);

/** The scan a receiver reports at its infeed, as the line protocol carries it. */
function scanIn(unitId: string, jobId = `${unitId}-press-01`): void {
  const ident = identOf(DEFAULT_LINE, 'press-01');
  const body = { event: 'arrived', jobId, unitId, orderRef: 'ORD-1', recipe: null, carrierId: `CR-${unitId}`, visitId: `visit-${unitId}` };
  rig.broker.publish(machineTopic(ROOT, ident, CHANNEL.JOB), JSON.stringify(buildEnvelope(ident, body)));
}

describe('a handoff that ends before its units move', () => {
  it('withdraws the job the receiver was sent', async () => {
    rig = await startRig();
    await rig.handoff('U1', null, 'press-01');
    rig.line.arm('press-01', { result: 'hold', reason: 'edge out of range' });
    const ended = await rig.handoff('U1', 'press-01', 'cut-01');
    expect(ended.resolver_payload).toMatchObject({ received: false, errorCode: 'sender-rejected', result: 'hold' });
    await until(() => cancels('cut-01')[0]);
    expect(cancels('cut-01')[0].args).toMatchObject({ jobId: 'U1-cut-01' });
  });

  it('leaves alone a receiver whose job waits for the units to arrive', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, DEFAULT_LINE, { codec: genericCodec({ root: ROOT, dispatchOn: DISPATCH_ON.ARRIVAL }) });
    const entry = rig.park('U1', null, 'press-01');
    scanIn('U1');
    await rig.lt.ended(entry.id);
    rig.line.arm('press-01', { result: 'hold', reason: 'edge out of range' });
    const hop = rig.park('U1', 'press-01', 'cut-01');
    await rig.line.arrive('press-01', { unitId: 'U1', carrierId: 'CR-U1' });
    const ended = await rig.lt.ended(hop.id);
    expect(ended.resolver_payload).toMatchObject({ received: false, errorCode: 'sender-rejected', result: 'hold' });
    await rig.gateway.idle();
    await sleep(50);
    expect(rig.recorder.commands('cut-01', OP.DISPATCH)).toEqual([]);
    expect(cancels('cut-01')).toEqual([]);
  });
});
