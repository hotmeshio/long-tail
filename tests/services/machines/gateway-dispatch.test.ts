import { describe, it, expect, afterEach } from 'vitest';

import { JOB_EVENT, OP, genericCodec } from '../../../lib/machines/protocol';
import { CONTROLLER } from '../../../services/machines/gateway/actions';
import { GATEWAY_LOG } from '../../../services/machines/gateway/log';
import { RecordingLog } from '../../../services/machines/testing/recording-log';
import { facetsFor, startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ROOT, sleep, until } from '../../helpers/machine-line-fixtures';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

let rig: LineRig;
afterEach(async () => rig?.stop());

const press = () => rig.line.machine('press-01');

describe('dispatch: a machine that is away', () => {
  it('no reply resolves no-reply and cancels the job, so the queued dispatch never runs on reconnect', async () => {
    rig = await startRig({}, { replyTimeoutMs: 30 });
    await rig.line.network('press-01', { mode: 'drop' });
    const ended = await rig.handoff('U1', null, 'press-01');
    expect(ended.resolver_payload).toMatchObject({ received: false, errorCode: 'no-reply' });
    await rig.gateway.idle();
    await rig.line.network('press-01', { mode: 'restore' });
    await until(() => rig.recorder.replies('press-01').some((r) => r.reason === 'withdrew U1-press-01'), 2_000);
    await sleep(30);
    expect(press().cell.jobs.size).toBe(0);
    expect(rig.recorder.jobs('press-01', JOB_EVENT.STARTED)).toEqual([]);
  });

  it('a dispatch past its expiry is refused by the machine, never run', async () => {
    rig = await startRig({}, { replyTimeoutMs: 20, dispatchTtlMs: 10 });
    await rig.line.network('press-01', { mode: 'drop' });
    await rig.handoff('U1', null, 'press-01');
    await sleep(30);
    await rig.line.network('press-01', { mode: 'restore' });
    await sleep(50);
    expect(rig.recorder.replies('press-01').some((r) => /expired/.test(r.reason))).toBe(true);
    expect(rig.recorder.jobs('press-01', JOB_EVENT.STARTED)).toEqual([]);
  });
});

describe('dispatch: the machine says no', () => {
  it('a failed artifact check resolves dispatch-refused with the machine\'s reason', async () => {
    rig = await startRig();
    const stored = rig.line.payloads.put(Buffer.from('program'));
    const row = rig.lt.park('line-bond', { ...facetsFor('U1', null, 'press-01'), artifactUrl: stored.url, artifactSha256: 'deadbeef' });
    const ended = await rig.lt.ended(row.id);
    expect(ended.resolver_payload).toMatchObject({ received: false, errorCode: 'dispatch-refused' });
    expect(ended.resolver_payload!.detail).toMatch(/failed/);
  });

  it('a full queue refuses the next job', async () => {
    rig = await startRig({ queueCapacity: 1, autoArriveAtEntry: false });
    rig.lt.park('line-bond', facetsFor('U1', null, 'press-01'));
    const second = await rig.lt.ended(rig.lt.park('line-bond', facetsFor('U2', null, 'press-01')).id);
    expect(second.resolver_payload).toMatchObject({ errorCode: 'dispatch-refused' });
    expect(second.resolver_payload!.detail).toMatch(/queue full/);
  });

  it('a machine in maintenance refuses work', async () => {
    rig = await startRig();
    await rig.line.maintenanceStart('press-01');
    const ended = await rig.handoff('U1', null, 'press-01');
    expect(ended.resolver_payload).toMatchObject({ errorCode: 'dispatch-refused' });
    expect(ended.resolver_payload!.detail).toMatch(/maintenance/);
  });
});

describe('dispatch: one unit per dispatch', () => {
  const perUnit = { codec: genericCodec({ root: ROOT, unitsPerDispatch: 1 }) };

  it('a single unit runs end to end with its own job', async () => {
    rig = await startRig({}, {}, DEFAULT_LINE, perUnit);
    const ended = await rig.handoff('A1', null, 'press-01');
    expect(ended.resolver_payload).toMatchObject({ received: true, units: ['A1'] });
    expect(rig.recorder.commands('press-01', OP.DISPATCH)[0].args).toMatchObject({ jobId: 'A1-press-01', units: [{ unitId: 'A1' }] });
  });

  it('sends one job per unit and claims once every job is accepted', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, DEFAULT_LINE, perUnit);
    const row = rig.park(['A1', 'A2'], null, 'press-01');
    await until(() => rig.lt.calls.some((c) => c.verb === 'claim' && c.id === row.id));
    expect(rig.recorder.commands('press-01', OP.DISPATCH).map((c) => [c.cmdId.split(':').pop(), c.args.jobId, c.args.units.map((u: any) => u.unitId)]))
      .toEqual([['dispatch#1', 'A1-press-01#1', ['A1']], ['dispatch#2', 'A1-press-01#2', ['A2']]]);
    expect([...press().cell.jobs.keys()]).toEqual(['A1-press-01#1', 'A1-press-01#2']);
  });

  it('one refused unit fails the handoff and cancels the unit already accepted', async () => {
    rig = await startRig({ autoArriveAtEntry: false, queueCapacity: 1 }, {}, DEFAULT_LINE, perUnit);
    const ended = await rig.lt.ended(rig.park(['B1', 'B2'], null, 'press-01').id);
    expect(ended.resolver_payload).toMatchObject({ errorCode: 'dispatch-refused' });
    expect(ended.resolver_payload!.detail).toMatch(/queue full/);
    await until(() => rig.recorder.replies('press-01').some((r) => r.reason === 'withdrew B1-press-01#1'));
    expect(press().cell.jobs.size).toBe(0);
  });
});

describe('commands: replies are tracked', () => {
  it('logs a cancel the machine refuses and an ack nobody answers', async () => {
    const log = new RecordingLog();
    rig = await startRig({}, { replyTimeoutMs: 20 }, DEFAULT_LINE, { log });
    await rig.handoff('U1', null, 'press-01');
    await rig.line.machine('cut-01').enable(false);
    const row = rig.park('U1', 'press-01', 'cut-01');
    await until(() => rig.lt.calls.some((c) => c.verb === 'claim' && c.id === row.id));
    await until(() => press().cell.jobs.get('U1-press-01')?.status === 'done');
    rig.lt.cancel(row.id);
    await until(() => log.of(GATEWAY_LOG.COMMAND_REFUSED).length, 2_000);
    expect(log.of(GATEWAY_LOG.COMMAND_REFUSED)[0]).toMatchObject({ op: OP.CANCEL, machine: 'press-01' });

    rig.line.config('cut-01', { replyMode: 'drop' });
    await rig.line.fault('cut-01', { code: 'F-201' });
    const alarm = await until(() => [...rig.lt.rows.values()].find((r) => r.type === 'line-alarm'), 2_000);
    rig.lt.personResolves(alarm.id, { decision: 'acknowledge' });
    await until(() => log.of(GATEWAY_LOG.COMMAND_UNANSWERED).some((c) => c.op === OP.ACKNOWLEDGE_ALARM), 2_000);
  });
});

describe('dispatch: a machine that requires an artifact', () => {
  it('a row without one is refused by the controller and nothing reaches the machine', async () => {
    const line = { ...DEFAULT_LINE, machines: DEFAULT_LINE.machines.map((m) => (m.machineId === 'press-01' ? { ...m, requireArtifact: true } : m)) };
    rig = await startRig({}, {}, line);
    const ended = await rig.handoff('U1', null, 'press-01');
    expect(ended.resolved_by).toBe(CONTROLLER);
    expect(ended.resolver_payload).toMatchObject({ received: false, errorCode: 'dispatch-refused' });
    expect(rig.recorder.commands('press-01', OP.DISPATCH)).toEqual([]);
  });
});

