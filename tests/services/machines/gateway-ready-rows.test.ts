import { describe, it, expect, afterEach } from 'vitest';

import { CHANNEL, OP, REPLY_STATUS, buildEnvelope, machineTopic } from '../../../lib/machines/protocol';
import { PACE_BY, identOf, type LineDef } from '../../../lib/machines/line';
import { DECISION, ROW_TYPE } from '../../../services/machines/contracts';
import { commandTarget, readyRow } from '../../../services/machines/commands';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ROOT, sleep, until } from '../../helpers/machine-line-fixtures';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

let rig: LineRig;
afterEach(async () => rig?.stop());

const byReady: LineDef = {
  ...DEFAULT_LINE, machines: DEFAULT_LINE.machines.map((m) => (m.machineId === 'press-01' ? { ...m, paceBy: PACE_BY.READY } : m)),
};
const ident = () => identOf(DEFAULT_LINE, 'press-01');
const envelope = (body: Record<string, unknown>) => buildEnvelope(ident(), body);
const publish = (env: ReturnType<typeof envelope>) => rig.broker.publish(machineTopic(ROOT, ident(), CHANNEL.READY), JSON.stringify(env));
const dispatchedTo = (machineId: string) => rig.recorder.commands(machineId, OP.DISPATCH).map((c) => c.args.jobId);
const readyRows = () => rig.lt.ofType(ROW_TYPE.MACHINE_READY);
const start = () => startRig({ autoArriveAtEntry: false }, {}, byReady);

describe('a machine\'s ready is a machine-ready row', () => {
  it('raised on the machine\'s role, and resolved naming the handoff once the machine accepts the dispatch it went to', async () => {
    rig = await start();
    publish(envelope({}));
    const ready = await until(() => readyRows()[0]);
    expect(ready).toMatchObject({ role: commandTarget(byReady, 'press-01').role, status: 'pending', metadata: { machineId: 'press-01' } });
    const handoff = rig.park('U1', null, 'press-01');
    await until(() => dispatchedTo('press-01').length === 1);
    expect((await rig.lt.ended(ready.id)).resolver_payload).toEqual({ decision: DECISION.DISPATCHED, rowId: handoff.id });
  });

  it('survives a takeover: a ready, then a new leader, then one dispatch with no new ready', async () => {
    rig = await start();
    publish(envelope({}));
    await until(() => readyRows()[0]);
    await rig.gateway.stop();
    rig.gateway = await rig.startGateway();
    rig.park('U1', null, 'press-01');
    await until(() => dispatchedTo('press-01').length === 1);
    rig.park('U2', null, 'press-01');
    await sleep(80);
    expect(dispatchedTo('press-01')).toEqual(['U1-press-01']);
  });

  it('spent on a handoff the old leader never saw accepted, goes back to a new leader, which sends that handoff again', async () => {
    rig = await start();
    await rig.gateway.stop();
    const handoff = rig.park('U1', null, 'press-01');
    const ready = rig.lt.parkRow(readyRow(commandTarget(byReady, 'press-01'), 'said ready') as any);
    rig.lt.personResolves(ready.id, { decision: DECISION.DISPATCHED, rowId: handoff.id });
    rig.gateway = await rig.startGateway();
    await until(() => dispatchedTo('press-01').length === 1);
    rig.park('U2', null, 'press-01');
    await sleep(80);
    expect(dispatchedTo('press-01')).toEqual(['U1-press-01']);
  });

  it('goes back when the machine refuses the dispatch it went to, for the next row', async () => {
    rig = await start();
    rig.line.config('press-01', { replyMode: 'drop' });
    publish(envelope({}));
    const ready = await until(() => readyRows()[0]);
    const first = rig.park('U1', null, 'press-01');
    const sent = await until(() => rig.recorder.commands('press-01', OP.DISPATCH)[0]);
    rig.broker.publish(machineTopic(ROOT, ident(), CHANNEL.REPLY), JSON.stringify(envelope({ cmdId: sent.cmdId, status: REPLY_STATUS.REFUSED, reason: 'no plate' })));
    expect((await rig.lt.ended(first.id)).resolver_payload).toMatchObject({ received: false });
    const second = rig.park('U2', null, 'press-01');
    await until(() => dispatchedTo('press-01').includes('U2-press-01'));
    expect((await rig.lt.ended(ready.id, 2_000)).resolver_payload).toEqual({ decision: DECISION.DISPATCHED, rowId: second.id });
  });

  it('may be raised by a person, admitting one job', async () => {
    rig = await start();
    const ready = rig.lt.parkRow(readyRow(commandTarget(byReady, 'press-01'), 'plate swapped') as any);
    rig.park('U1', null, 'press-01');
    await until(() => dispatchedTo('press-01').length === 1);
    expect((await rig.lt.ended(ready.id)).resolver_payload).toMatchObject({ decision: DECISION.DISPATCHED });
  });

  it('is withdrawn by ready: false, which resolves the row', async () => {
    rig = await start();
    publish(envelope({}));
    const ready = await until(() => readyRows()[0]);
    publish(envelope({ ready: false }));
    expect((await rig.lt.ended(ready.id)).resolver_payload).toEqual({ decision: DECISION.WITHDRAWN });
    rig.park('U1', null, 'press-01');
    await sleep(80);
    expect(dispatchedTo('press-01')).toEqual([]);
  });

  it('replayed after it was spent opens nothing new', async () => {
    rig = await start();
    const said = envelope({});
    publish(said);
    const ready = await until(() => readyRows()[0]);
    rig.park('U1', null, 'press-01');
    await rig.lt.ended(ready.id);
    publish(said);
    await sleep(50);
    rig.park('U2', null, 'press-01');
    await sleep(80);
    expect(readyRows()).toHaveLength(1);
    expect(dispatchedTo('press-01')).toEqual(['U1-press-01']);
  });
});
