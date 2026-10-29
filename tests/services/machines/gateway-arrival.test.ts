import { describe, it, expect, afterEach } from 'vitest';

import { CHANNEL, DISPATCH_ON, OP, buildEnvelope, genericCodec, machineTopic } from '../../../lib/machines/protocol';
import { identOf } from '../../../lib/machines/line';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { itemKeys } from '../../../services/machines/contracts';
import { ROOT, sleep, until } from '../../helpers/machine-line-fixtures';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';

let rig: LineRig;
afterEach(async () => rig?.stop());

const onArrival = { codec: genericCodec({ root: ROOT, dispatchOn: DISPATCH_ON.ARRIVAL }) };

/** The receiver scans a unit in, reporting its own visit id for it. */
function scanIn(unitId: string, visitId: string, jobId = `${unitId}-press-01`): void {
  const ident = identOf(DEFAULT_LINE, 'press-01');
  const body = { event: 'arrived', jobId, unitId, orderRef: 'ORD-1', recipe: null, carrierId: `CR-${unitId}`, visitId };
  rig.broker.publish(machineTopic(ROOT, ident, CHANNEL.JOB), JSON.stringify(buildEnvelope(ident, body)));
}

const dispatches = () => rig.recorder.commands('press-01', OP.DISPATCH);

/** The receiver reads only the carrier: no unit id, no job id. */
function scanCarrier(body: Record<string, unknown>): void {
  const ident = identOf(DEFAULT_LINE, 'press-01');
  rig.broker.publish(machineTopic(ROOT, ident, CHANNEL.JOB), JSON.stringify(buildEnvelope(ident, { orderRef: 'ORD-1', recipe: null, ...body })));
}

describe('dispatch on arrival', () => {
  it('sends the job once the unit is scanned in, with the scan, and the acceptance completes the handoff', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, DEFAULT_LINE, onArrival);
    const row = rig.park('U1', null, 'press-01');
    await sleep(40);
    expect(dispatches()).toEqual([]);
    scanIn('U1', 'visit-1');
    const ended = await rig.lt.ended(row.id);
    expect(ended).toMatchObject({ status: 'resolved', resolved_by: 'press-01' });
    expect(ended.resolver_payload).toMatchObject({ received: true, receiver: 'press-01', units: ['U1'] });
    const [sent] = dispatches();
    expect(sent.args.units[0]).toMatchObject({ unitId: 'U1', carrierId: 'CR-U1', arrival: { visitId: 'visit-1', carrierId: 'CR-U1' } });
  });

  it('waits for every unit of the row before sending one job for them', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, DEFAULT_LINE, onArrival);
    const row = rig.park(['U1', 'U2'], null, 'press-01');
    scanIn('U1', 'visit-1');
    await sleep(40);
    expect(dispatches()).toEqual([]);
    scanIn('U2', 'visit-2', 'U1-press-01');
    await rig.lt.ended(row.id);
    expect(dispatches()).toHaveLength(1);
    expect(dispatches()[0].args.units.map((u: any) => u.arrival.visitId)).toEqual(['visit-1', 'visit-2']);
  });

  it('a machine that refuses the job after the scan ends the handoff as dispatch-refused', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, DEFAULT_LINE, onArrival);
    await rig.line.maintenanceStart('press-01');
    const row = rig.park('U1', null, 'press-01');
    scanIn('U1', 'visit-1');
    const ended = await rig.lt.ended(row.id);
    expect(ended.resolver_payload).toMatchObject({ received: false, errorCode: 'dispatch-refused' });
  });

  it('a scan delivered again after the job went out sends nothing more', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, DEFAULT_LINE, onArrival);
    const row = rig.park('U1', null, 'press-01');
    scanIn('U1', 'visit-1');
    await rig.lt.ended(row.id);
    scanIn('U1', 'visit-1');
    await rig.gateway.idle();
    await sleep(20);
    expect(dispatches()).toHaveLength(1);
  });

  it('after a restart, sends the job for units that arrived while no gateway listened', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, DEFAULT_LINE, onArrival);
    await rig.gateway.stop();
    const row = rig.park('U1', null, 'press-01');
    await rig.lt.accumulate('press-01', row.id, itemKeys.arrived('U1'), { unitId: 'U1', carrierId: 'CR-U1', arrival: { unitId: 'U1', visitId: 'visit-9' } });
    rig.gateway = await rig.startGateway();
    const ended = await rig.lt.ended(row.id);
    expect(ended.resolver_payload).toMatchObject({ received: true });
    await until(() => dispatches().length, 2_000);
    expect(dispatches()[0].args.units[0].arrival).toMatchObject({ visitId: 'visit-9' });
  });

  it('a scan that reads only the carrier finds the unit the handoff carries on it', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, DEFAULT_LINE, onArrival);
    const row = rig.park('U1', null, 'press-01');
    scanCarrier({ event: 'arrived', carrierId: 'CR-U1', visitId: 'visit-3' });
    const ended = await rig.lt.ended(row.id);
    expect(ended.resolver_payload).toMatchObject({ received: true, units: ['U1'] });
    expect(dispatches()[0].args.units[0]).toMatchObject({ unitId: 'U1', arrival: { carrierId: 'CR-U1', visitId: 'visit-3' } });
  });

  it('a carrier the receiver could not read the unit on ends the handoff as unreadable-id', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, DEFAULT_LINE, onArrival);
    const row = rig.park('U1', null, 'press-01');
    scanCarrier({ event: 'transfer-failed', carrierId: 'CR-U1', failure: 'unreadable-id' });
    const ended = await rig.lt.ended(row.id);
    expect(ended.resolver_payload).toMatchObject({ received: false, errorCode: 'unreadable-id' });
    expect(dispatches()).toEqual([]);
  });
});
