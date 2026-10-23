import { describe, it, expect, afterEach } from 'vitest';

import { OP, genericCodec } from '../../../lib/machines/protocol';
import { commandRow, commandTarget } from '../../../services/machines/commands';
import { stationRole } from '../../../lib/machines/line';
import { facetsFor, startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ROOT, sleep, until } from '../../helpers/machine-line-fixtures';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

let rig: LineRig;
afterEach(async () => rig?.stop());

const perUnit = { codec: genericCodec({ root: ROOT, unitsPerDispatch: 1 }) };
const cancels = (machineId: string) => rig.recorder.commands(machineId, OP.CANCEL).map((c) => c.args.jobId);
const arrivedOn = (rowId: string, unitId: string) => () => rig.lt.rows.get(rowId)!.items.some((i) => i.itemKey === `arrived:${unitId}`);

/** A row into press-01 whose first unit arrives by hand; the rest never come. */
async function partlyArrived(units: string[]) {
  const row = rig.park(units, null, 'press-01');
  await until(() => rig.lt.calls.some((c) => c.verb === 'claim' && c.id === row.id));
  await rig.line.arrive('press-01', { unitId: units[0], carrierId: `CR-${units[0]}` });
  await until(arrivedOn(row.id, units[0]));
  return row;
}

async function settled() {
  await rig.gateway.idle();
  await sleep(30);
}

describe('started work is the workflow\'s to stop', () => {
  it('a row that times out after a unit arrived leaves the receiver\'s job; a command row stops it', async () => {
    rig = await startRig({ autoArriveAtEntry: false });
    const row = await partlyArrived(['U1', 'U2']);
    rig.lt.expire(row.id);
    await settled();
    expect(cancels('press-01')).toEqual([]);

    const stop = rig.lt.parkRow(commandRow(commandTarget(DEFAULT_LINE, 'press-01'), OP.CANCEL, { jobId: 'U1-press-01' }));
    const ended = await rig.lt.ended(stop.id);
    expect(ended.resolver_payload).toMatchObject({ accepted: true, op: OP.CANCEL });
    expect(cancels('press-01')).toEqual(['U1-press-01']);
  });

  it('a row that times out before any unit arrived still withdraws its dispatch', async () => {
    rig = await startRig({ autoArriveAtEntry: false });
    const row = rig.park(['U1', 'U2'], null, 'press-01');
    await until(() => rig.lt.calls.some((c) => c.verb === 'claim' && c.id === row.id));
    rig.lt.expire(row.id);
    await until(() => cancels('press-01').length);
    expect(cancels('press-01')).toEqual(['U1-press-01']);
  });

  it('one job per unit: a timeout withdraws only the jobs whose units never arrived', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, DEFAULT_LINE, perUnit);
    const row = await partlyArrived(['A1', 'A2', 'A3']);
    rig.lt.expire(row.id);
    await until(() => cancels('press-01').length === 2);
    await settled();
    expect(cancels('press-01').sort()).toEqual(['A1-press-01#2', 'A1-press-01#3']);
  });

  it('a gateway that takes over reads the arrivals back from the row, so the timeout still leaves the job', async () => {
    rig = await startRig({ autoArriveAtEntry: false });
    const row = await partlyArrived(['U1', 'U2']);
    await rig.gateway.stop();
    rig.gateway = await rig.startGateway();
    rig.lt.expire(row.id);
    await settled();
    expect(cancels('press-01')).toEqual([]);
  });

  it('a cancel row without the job to cancel is unsupported and never sent', async () => {
    rig = await startRig();
    const ended = await rig.lt.ended(rig.lt.parkRow(commandRow(commandTarget(DEFAULT_LINE, 'press-01'), OP.CANCEL)).id);
    expect(ended.resolver_payload).toMatchObject({ accepted: false, status: 'unsupported' });
    expect(ended.resolver_payload!.reason).toMatch(/needs args.jobId/);
    expect(cancels('press-01')).toEqual([]);
  });
});

describe('handoffs for some of a route\'s units', () => {
  const intoCut = (unitId: string, senderJobId: string) =>
    rig.lt.park(stationRole('trim'), { ...facetsFor(unitId, 'press-01', 'cut-01'), senderJobId });

  for (const [name, seams] of [['one job for all units', {}], ['one job per unit', perUnit]] as const) {
    it(`${name}: each unit moves on in a row of its own, out of the job that carried both`, { timeout: 30_000 }, async () => {
      rig = await startRig({}, {}, DEFAULT_LINE, seams);
      const entry = rig.park(['S1', 'S2'], null, 'press-01');
      const rows = { S1: intoCut('S1', 'S1-press-01'), S2: intoCut('S2', 'S1-press-01') };
      for (const unitId of ['S1', 'S2'] as const) {
        const ended = await rig.lt.ended(rows[unitId].id, 8_000);
        expect(ended.resolver_payload).toMatchObject({ received: true, receiver: 'cut-01', units: [unitId] });
        expect(ended.items.map((i) => i.itemKey)).toEqual([`released:${unitId}`, `arrived:${unitId}`]);
        // A person takes the unit off cut-01, so its station is free for the next one.
        for (let i = 0; i < 100 && !(await rig.line.unload('cut-01', { unitId })); i++) await sleep(50);
      }
      expect((await rig.lt.ended(entry.id, 8_000)).resolver_payload).toMatchObject({ received: true });
    });
  }

  it('a second open handoff naming a job already in use at the machine is refused, loudly', async () => {
    rig = await startRig({ autoArriveAtEntry: false });
    rig.park('U1', null, 'press-01');
    const clash = await rig.lt.ended(rig.park(['U1', 'U9'], null, 'press-01').id);
    expect(clash.resolver_payload).toMatchObject({ received: false, errorCode: 'dispatch-refused' });
    expect(clash.resolver_payload!.detail).toMatch(/job U1-press-01 at press-01 already belongs to handoff/);
    expect(rig.recorder.commands('press-01', OP.DISPATCH)).toHaveLength(1);
  });
});
