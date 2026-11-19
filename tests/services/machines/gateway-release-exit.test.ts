import { describe, it, expect, afterEach } from 'vitest';

import { CHANNEL, JOB_EVENT, JOB_RESULT, buildEnvelope, machineTopic } from '../../../lib/machines/protocol';
import { identOf } from '../../../lib/machines/line';
import { HANDOFF_ERROR, HANDOFF_EXIT, LINE_ROLE, itemKeys } from '../../../services/machines/contracts';
import { readHandoffFacets } from '../../../services/machines/rows';
import { facetsFor, startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ROOT, sleep } from '../../helpers/machine-line-fixtures';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

let rig: LineRig;
afterEach(async () => rig?.stop());

const job = (machineId: string, body: Record<string, unknown>) => {
  const ident = identOf(DEFAULT_LINE, machineId);
  rig.broker.publish(machineTopic(ROOT, ident, CHANNEL.JOB), JSON.stringify(buildEnvelope(ident, { orderRef: 'ORD-1', recipe: null, ...body })));
};
/** Units of one job finish under the job's id, named for its first unit. */
const finished = (unitId: string, result: string = JOB_RESULT.OK, jobId = `${unitId}-inspect-01`) =>
  job('inspect-01', { event: JOB_EVENT.FINISHED, unitId, jobId, result, ...(result === JOB_RESULT.OK ? {} : { reason: 'cracked' }) });
const exitRow = (units: string[]) => rig.lt.park(LINE_ROLE.EXIT, { ...facetsFor(units, 'inspect-01', null), exit: HANDOFF_EXIT.FINISH });
const items = (rowId: string) => rig.lt.rows.get(rowId)!.items.map((i) => i.itemKey);

describe('a release that passes a unit through unprocessed', () => {
  it('writes its own released note on the next hop, marked not processed', async () => {
    rig = await startRig({ autoArriveAtEntry: false });
    const next = rig.park('U1', 'press-01', 'cut-01');
    job('press-01', { event: JOB_EVENT.RELEASED, unitId: 'U1', jobId: 'U1-press-01', processed: false });
    await sleep(60);
    const note = rig.lt.rows.get(next.id)!.items.find((i) => i.itemKey === itemKeys.released('U1'));
    expect(note).toMatchObject({ actor: 'press-01', payload: { processed: false, unitId: 'U1' } });
  });

  it('writes nothing for a plain release', async () => {
    rig = await startRig({ autoArriveAtEntry: false });
    const next = rig.park('U1', 'press-01', 'cut-01');
    job('press-01', { event: JOB_EVENT.RELEASED, unitId: 'U1', jobId: 'U1-press-01' });
    await sleep(60);
    expect(items(next.id)).not.toContain(itemKeys.released('U1'));
  });
});

describe('an exit hop the sender\'s finish ends', () => {
  it('is read only on a hop with no receiving machine', () => {
    expect(readHandoffFacets({ ...facetsFor('U1', 'inspect-01', null), exit: 'finish' })?.exit).toBe(HANDOFF_EXIT.FINISH);
    expect(readHandoffFacets({ ...facetsFor('U1', 'press-01', 'cut-01'), exit: 'finish' })?.exit).toBeUndefined();
  });

  it('resolves received, as the sender, once every unit finished ok', async () => {
    rig = await startRig({ autoArriveAtEntry: false });
    const row = exitRow(['U1', 'U2']);
    finished('U1');
    await sleep(60);
    expect(rig.lt.rows.get(row.id)!.status).toBe('pending');
    finished('U2', JOB_RESULT.OK, 'U1-inspect-01');
    const ended = await rig.lt.ended(row.id);
    expect(ended.resolved_by).toBe('inspect-01');
    expect(ended.resolver_payload).toEqual({ received: true, units: ['U1', 'U2'] });
  });

  it('resolves sender-rejected on a finish that is not ok', async () => {
    rig = await startRig({ autoArriveAtEntry: false });
    const row = exitRow(['U1']);
    finished('U1', JOB_RESULT.REJECT);
    const ended = await rig.lt.ended(row.id);
    expect(ended.resolver_payload).toMatchObject({ received: false, errorCode: HANDOFF_ERROR.SENDER_REJECTED, result: JOB_RESULT.REJECT });
  });

  it('ends on a pass-through release too', async () => {
    rig = await startRig({ autoArriveAtEntry: false });
    const row = exitRow(['U1']);
    job('inspect-01', { event: JOB_EVENT.RELEASED, unitId: 'U1', jobId: 'U1-inspect-01', processed: false });
    expect((await rig.lt.ended(row.id)).resolver_payload).toEqual({ received: true, units: ['U1'] });
  });

  it('without the facet waits for a person, as before', async () => {
    rig = await startRig({ autoArriveAtEntry: false });
    const row = rig.lt.park(LINE_ROLE.EXIT, facetsFor('U1', 'inspect-01', null));
    finished('U1');
    await sleep(80);
    expect(rig.lt.rows.get(row.id)!.status).toBe('pending');
    expect(items(row.id)).toContain(itemKeys.released('U1'));
  });
});
