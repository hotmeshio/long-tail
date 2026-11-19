import { describe, it, expect, afterEach } from 'vitest';

import { CHANNEL, DISPATCH_ON, OP, buildEnvelope, genericCodec, machineTopic } from '../../../lib/machines/protocol';
import { PACE_BY, identOf, validateLine, type LineDef } from '../../../lib/machines/line';
import { MachineGateway } from '../../../services/machines/gateway/gateway';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ROOT, sleep, until } from '../../helpers/machine-line-fixtures';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

let rig: LineRig;
afterEach(async () => rig?.stop());

const byReady: LineDef = {
  ...DEFAULT_LINE, machines: DEFAULT_LINE.machines.map((m) => (m.machineId === 'press-01' ? { ...m, paceBy: PACE_BY.READY } : m)),
};
const ident = () => identOf(DEFAULT_LINE, 'press-01');
const publish = (channel: string, body: Record<string, unknown>) =>
  rig.broker.publish(machineTopic(ROOT, ident(), channel), JSON.stringify(buildEnvelope(ident(), body)));
const dispatchedTo = (machineId: string) => rig.recorder.commands(machineId, OP.DISPATCH).map((c) => c.args.jobId);

describe('a machine paced by ready', () => {
  it('is sent one job per ready, oldest first, and none before it says ready', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, byReady);
    const rows = ['U1', 'U2', 'U3'].map((u) => rig.park(u, null, 'press-01'));
    await sleep(80);
    expect(dispatchedTo('press-01')).toEqual([]);
    publish(CHANNEL.READY, {});
    await until(() => dispatchedTo('press-01').length === 1);
    await sleep(50);
    expect(dispatchedTo('press-01')).toEqual(['U1-press-01']);
    publish(CHANNEL.READY, {});
    await until(() => dispatchedTo('press-01').length === 2);
    expect(dispatchedTo('press-01')[1]).toBe('U2-press-01');
    expect(rig.lt.rows.get(rows[2].id)!.status).toBe('pending');
  });

  it('keeps a ready said while nothing waits, for the next row', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, byReady);
    publish(CHANNEL.READY, {});
    await sleep(50);
    rig.park('U1', null, 'press-01');
    await until(() => dispatchedTo('press-01').length === 1);
    rig.park('U2', null, 'press-01');
    await sleep(80);
    expect(dispatchedTo('press-01')).toEqual(['U1-press-01']);
  });

  it('reads ready from a snapshot, and a withdrawn ready sends nothing', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, byReady);
    publish(CHANNEL.READY, {});
    publish(CHANNEL.READY, { ready: false });
    await sleep(50);
    rig.park('U1', null, 'press-01');
    await sleep(80);
    expect(dispatchedTo('press-01')).toEqual([]);
    publish(CHANNEL.SNAPSHOT, { mode: 'idle', enabled: true, jobs: [], alarms: [], ready: true });
    await until(() => dispatchedTo('press-01').length === 1);
  });

  it('leaves other machines paced by depth alone', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, byReady);
    rig.park('U1', null, 'cut-01');
    await until(() => dispatchedTo('cut-01').length === 1);
  });
});

describe('paceBy in a line definition', () => {
  it('is ready or unset', () => {
    expect(validateLine(byReady)).toBe(byReady);
    const bad = { ...DEFAULT_LINE, machines: [{ ...DEFAULT_LINE.machines[0], paceBy: 'slow' as any }] };
    expect(() => validateLine(bad)).toThrow(/paceBy must be one of ready/);
  });

  it('is refused on a line whose codec dispatches on arrival', () => {
    expect(() => new MachineGateway({
      bus: {} as any, feed: {} as any, lt: {} as any, line: byReady,
      settings: { topicRoot: ROOT } as any, codec: genericCodec({ root: ROOT, dispatchOn: DISPATCH_ON.ARRIVAL }),
    })).toThrow(/press-01: paceBy ready needs dispatch on creation/);
  });
});
