import { afterEach, describe, expect, it } from 'vitest';
import { MachineGateway, type GatewaySettings } from '../../../services/machines/gateway/gateway';
import { silentLog } from '../../../services/machines/gateway/log';
import { progressStepOf } from '../../../services/machines/gateway/lifecycle';
import { LINE_ROLE } from '../../../services/machines/contracts';
import { identOf, machineById, stationRole } from '../../../lib/machines/line';
import { CHANNEL, JOB_EVENT, LEVEL, REPLY_STATUS, alarmTopic, buildEnvelope, lineFilter, machineTopic } from '../../../lib/machines/protocol';
import { MemoryBroker, MemoryEscalationFeed, MemoryMachineBus } from '../../../lib/machines/transport';
import { FakeLongTail } from '../../../services/machines/testing/fake-long-tail';
import { sleep, until } from '../../../services/machines/testing/wait';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { GATEWAY_SETTINGS, facetsFor } from '../../helpers/machine-line-gateway-harness';
import { ROOT } from '../../helpers/machine-line-fixtures';

const PRESS = 'press-01';
const ident = identOf(DEFAULT_LINE, PRESS);
const JOB = 'U1-press-01';

interface Rig { broker: MemoryBroker; lt: FakeLongTail; gateway: MachineGateway }
let rig: Rig | undefined;

afterEach(async () => {
  await rig?.gateway.stop();
  rig = undefined;
});

/** A gateway with lifecycle notes on, on a bare broker; the press is played by hand and accepts every command. */
async function startRig(settings: Partial<GatewaySettings> = {}): Promise<Rig> {
  const broker = new MemoryBroker();
  const feed = new MemoryEscalationFeed(broker);
  const lt = new FakeLongTail(feed);
  broker.connect('press-hand');
  broker.subscribe('press-hand', machineTopic(ROOT, ident, CHANNEL.CMD), (msg) => {
    const cmd = JSON.parse(msg.payload.toString()).body;
    broker.publish(machineTopic(ROOT, ident, CHANNEL.REPLY), JSON.stringify(buildEnvelope(ident, { cmdId: cmd.cmdId, status: REPLY_STATUS.ACCEPTED, reason: '' })));
  });
  const gateway = new MachineGateway({
    bus: new MemoryMachineBus(broker, lineFilter(ROOT, DEFAULT_LINE.siteId, DEFAULT_LINE.lineId)),
    feed, lt, line: DEFAULT_LINE, settings: { ...GATEWAY_SETTINGS, lifecycle: true, ...settings }, log: silentLog,
  });
  await gateway.start();
  return { broker, lt, gateway };
}

const job = (r: Rig, event: string, extra: Record<string, unknown> = {}) =>
  r.broker.publish(machineTopic(ROOT, ident, CHANNEL.JOB), JSON.stringify(buildEnvelope(ident, {
    event, jobId: JOB, unitId: 'U1', orderRef: 'ORD-1', recipe: null, carrierId: 'CR-U1', ...extra,
  })));

const alarm = (r: Rig, active: boolean) =>
  r.broker.publish(alarmTopic(ROOT, ident, 'A-7'), JSON.stringify(buildEnvelope(ident, {
    alarmId: 'A-7', code: 'F-7', level: LEVEL.CRITICAL, text: 'feed ran out', active, raisedAt: '2026-10-28T10:00:00.000Z',
    clearedAt: active ? null : '2026-10-28T10:05:00.000Z', clearedBy: active ? null : 'tech-1', ackedBy: null, ackedAt: null,
    zone: null, autoClears: false, action: null, jobId: JOB,
  })), active);

/** The dispatch into the press, accepted and claimed, its units not yet arrived. */
async function running(r: Rig, extra: Record<string, unknown> = {}) {
  const row = r.lt.park(stationRole(machineById(DEFAULT_LINE, PRESS).process), { ...facetsFor('U1', null, PRESS), ...extra } as ReturnType<typeof facetsFor>);
  await until(() => r.lt.rows.get(row.id)?.assigned_to === PRESS);
  return row;
}

const keysOf = (r: Rig, id: string) => r.lt.rows.get(id)!.items.map((i) => i.itemKey);

describe('job lifecycle on the row', () => {
  it('notes the start and each progress step on the accepted dispatch, before the units arrive', async () => {
    rig = await startRig();
    const row = await running(rig);
    job(rig, JOB_EVENT.STARTED);
    for (let percent = 0; percent <= 100; percent += 1) job(rig, JOB_EVENT.PROGRESS, { percent, remainingSec: 100 - percent, detail: { layer: percent } });
    await until(() => keysOf(rig!, row.id).length === 4);
    await sleep(50);
    expect(keysOf(rig, row.id)).toEqual(['started:U1', 'progress:U1:25', 'progress:U1:50', 'progress:U1:75']);
    expect(rig.lt.rows.get(row.id)!.items.every((i) => i.actor === PRESS)).toBe(true);
    expect(rig.lt.rows.get(row.id)!.metadata.progress).toMatchObject({ percent: 75, remainingSec: 25, detail: { layer: 75 } });

    job(rig, JOB_EVENT.ARRIVED);
    const ended = await rig.lt.ended(row.id);
    expect(ended.resolver_payload).toMatchObject({ received: true, receiver: PRESS });
    expect(keysOf(rig, row.id).at(-1)).toBe('arrived:U1');
  });

  it('notes progress on the handoff out of the machine once the units are there', async () => {
    rig = await startRig();
    const row = await running(rig);
    job(rig, JOB_EVENT.ARRIVED);
    await rig.lt.ended(row.id);
    const out = rig.lt.park(LINE_ROLE.EXIT, facetsFor('U1', PRESS, null));
    await sleep(20);
    job(rig, JOB_EVENT.PROGRESS, { percent: 52 });
    await until(() => keysOf(rig!, out.id).length === 1);
    expect(keysOf(rig, out.id)).toEqual(['progress:U1:50']);
  });

  it('adds nothing for a replayed event, a job no row holds, or progress below the first step', async () => {
    rig = await startRig();
    const row = await running(rig);
    for (let i = 0; i < 3; i++) job(rig, JOB_EVENT.PROGRESS, { percent: 30 });
    job(rig, JOB_EVENT.PROGRESS, { percent: 10 });
    job(rig, JOB_EVENT.PROGRESS, { percent: 60, jobId: 'U9-press-01', unitId: 'U9' });
    await until(() => keysOf(rig!, row.id).length === 1);
    await sleep(50);
    expect(keysOf(rig, row.id)).toEqual(['progress:U1:25']);
    expect(rig.lt.calls.filter((c) => c.verb === 'accumulate')).toHaveLength(1);
  });

  it('notes a stopping alarm as paused, and its clear as resumed, beside the alarm row', async () => {
    rig = await startRig();
    const row = await running(rig);
    alarm(rig, true);
    const alarmRow = await until(() => [...rig!.lt.rows.values()].find((r) => r.type === 'line-alarm'));
    await until(() => keysOf(rig!, row.id).length === 1);
    alarm(rig, false);
    await rig.lt.ended(alarmRow.id);
    await until(() => keysOf(rig!, row.id).length === 2);
    expect(keysOf(rig, row.id)).toEqual(['paused:A-7:2026-10-28T10:00:00.000Z', 'resumed:A-7:2026-10-28T10:00:00.000Z']);
    expect(rig.lt.rows.get(row.id)!.items[0].payload).toMatchObject({ alarmId: 'A-7', code: 'F-7', text: 'feed ran out' });
    expect(rig.lt.rows.get(row.id)!.items[1].payload).toMatchObject({ clearedBy: 'tech-1' });
    expect(rig.lt.rows.get(row.id)!.status).toBe('pending');
  });

  it('notes nothing unless lifecycle notes are on', async () => {
    rig = await startRig({ lifecycle: false });
    const row = await running(rig);
    job(rig, JOB_EVENT.STARTED);
    job(rig, JOB_EVENT.PROGRESS, { percent: 80 });
    alarm(rig, true);
    await until(() => [...rig!.lt.rows.values()].find((r) => r.type === 'line-alarm'));
    await sleep(50);
    expect(keysOf(rig, row.id)).toEqual([]);
    expect(rig.lt.rows.get(row.id)!.metadata.progress).toBeUndefined();
  });

  it('notes nothing on a row parked with a limit on its items', async () => {
    rig = await startRig();
    const row = await running(rig, { accumulate_max: 1 });
    job(rig, JOB_EVENT.STARTED);
    job(rig, JOB_EVENT.PROGRESS, { percent: 80 });
    await sleep(100);
    expect(keysOf(rig, row.id)).toEqual([]);
    job(rig, JOB_EVENT.ARRIVED);
    expect((await rig.lt.ended(row.id)).resolver_payload).toMatchObject({ received: true });
    expect(keysOf(rig, row.id)).toEqual(['arrived:U1']);
  });

  it('notes no progress when steps are off', async () => {
    rig = await startRig({ progressStep: 0 });
    const row = await running(rig);
    job(rig, JOB_EVENT.STARTED);
    job(rig, JOB_EVENT.PROGRESS, { percent: 80 });
    await until(() => keysOf(rig!, row.id).length === 1);
    await sleep(50);
    expect(keysOf(rig, row.id)).toEqual(['started:U1']);
  });
});

describe('progressStepOf', () => {
  it('reads the step reached, and nothing below the first, at 100, or with steps off', () => {
    expect(progressStepOf(24.9, 25)).toBeNull();
    expect(progressStepOf(25, 25)).toBe(25);
    expect(progressStepOf(99, 25)).toBe(75);
    expect(progressStepOf(100, 25)).toBeNull();
    expect(progressStepOf(55, 10)).toBe(50);
    expect(progressStepOf(55, 0)).toBeNull();
    expect(progressStepOf('55', 25)).toBeNull();
  });
});
