import { describe, it, expect, afterEach } from 'vitest';

import { OP, genericCodec } from '../../../lib/machines/protocol';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ROOT, sleep, until } from '../../helpers/machine-line-fixtures';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import type { LineDef } from '../../../lib/machines/line';

let rig: LineRig;
afterEach(async () => rig?.stop());

function lineWithDepth(depth: number): LineDef {
  return { ...DEFAULT_LINE, machines: DEFAULT_LINE.machines.map((m) => (m.machineId === 'press-01' ? { ...m, queueDepth: depth } : m)) };
}

const dispatchedTo = (machineId: string) => rig.recorder.commands(machineId, OP.DISPATCH).map((c) => c.args.jobId);

describe('pacing: a machine with a queue depth', () => {
  it('is sent no more than its depth; the rest wait unclaimed, never refused', async () => {
    rig = await startRig({ queueCapacity: 2, autoArriveAtEntry: false }, {}, lineWithDepth(2));
    const rows = ['U1', 'U2', 'U3', 'U4'].map((u) => rig.park(u, null, 'press-01'));
    await until(() => dispatchedTo('press-01').length === 2, 1_000);
    await sleep(50);
    expect(dispatchedTo('press-01')).toEqual(['U1-press-01', 'U2-press-01']);
    for (const r of rows.slice(2)) {
      expect(rig.lt.rows.get(r.id)!.status).toBe('pending');
      expect(rig.lt.rows.get(r.id)!.assigned_to).toBeUndefined();
    }
  });

  it('sends the oldest waiting row when a slot frees', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, lineWithDepth(1));
    const [first] = ['U1', 'U2', 'U3'].map((u) => rig.park(u, null, 'press-01'));
    await until(() => dispatchedTo('press-01').length === 1, 1_000);
    rig.lt.cancel(first.id);
    await until(() => dispatchedTo('press-01').length === 2, 1_000);
    expect(dispatchedTo('press-01')[1]).toBe('U2-press-01');
  });

  it('a unit that arrived holds its slot until it moves on to the next machine', async () => {
    rig = await startRig({}, {}, lineWithDepth(1));
    expect((await rig.handoff('U1', null, 'press-01')).resolver_payload).toMatchObject({ received: true });
    const second = rig.park('U2', null, 'press-01');
    await sleep(100);
    expect(dispatchedTo('press-01')).toEqual(['U1-press-01']);
    expect((await rig.handoff('U1', 'press-01', 'cut-01')).resolver_payload).toMatchObject({ received: true });
    await until(() => dispatchedTo('press-01').length === 2, 2_000);
    expect((await rig.lt.ended(second.id)).resolver_payload).toMatchObject({ received: true });
  });

  it('a gateway that takes the line keeps pacing: rows already sent count, waiting rows still wait', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, lineWithDepth(1));
    const [first, second] = ['U1', 'U2'].map((u) => rig.park(u, null, 'press-01'));
    await until(() => rig.lt.rows.get(first.id)!.assigned_to === 'press-01', 1_000);
    await rig.gateway.stop();
    rig.gateway = await rig.startGateway();
    await sleep(100);
    expect(dispatchedTo('press-01')).toEqual(['U1-press-01']);
    rig.lt.cancel(first.id);
    await until(() => dispatchedTo('press-01').length === 2, 1_000);
    expect(rig.lt.rows.get(second.id)!.status).toBe('pending');
  });

  it('an idle machine takes a row with more jobs than its depth, one job per unit', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, lineWithDepth(1), { codec: genericCodec({ root: ROOT, unitsPerDispatch: 1 }) });
    rig.park(['U1', 'U2'], null, 'press-01');
    await until(() => dispatchedTo('press-01').length === 2, 1_000);
    expect(dispatchedTo('press-01').sort()).toEqual(['U1-press-01#1', 'U1-press-01#2']);
  });
});
