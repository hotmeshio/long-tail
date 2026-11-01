import { describe, it, expect, afterEach } from 'vitest';

import { CHANNEL, DISPATCH_ON, OP, REPLY_STATUS, buildEnvelope, genericCodec, machineTopic } from '../../../lib/machines/protocol';
import { identOf } from '../../../lib/machines/line';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { dispatchCommandId } from '../../../services/machines/contracts';
import { GATEWAY_LOG } from '../../../services/machines/gateway/log';
import { RecordingLog } from '../../../services/machines/testing/recording-log';
import { ROOT, sleep, until } from '../../helpers/machine-line-fixtures';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';

let rig: LineRig;
afterEach(async () => rig?.stop());

const ident = () => identOf(DEFAULT_LINE, 'press-01');
const publish = (channel: string, body: Record<string, unknown>) => rig.broker.publish(machineTopic(ROOT, ident(), channel), JSON.stringify(buildEnvelope(ident(), body)));
const reply = (cmdId: string, status: string, extra: Record<string, unknown> = {}) => publish(CHANNEL.REPLY, { cmdId, status, reason: status, ...extra });
const scanIn = (unitId: string) => publish(CHANNEL.JOB, { event: 'arrived', jobId: `${unitId}-press-01`, unitId, orderRef: 'ORD-1', recipe: null, carrierId: `CR-${unitId}`, visitId: `visit-${unitId}` });
const snapshot = (bootId: string, jobs: { jobId: string }[]) => publish(CHANNEL.SNAPSHOT, { bootId, software: 'fw 1', mode: 'auto', enabled: true, jobs, alarms: [] });
const dispatches = () => rig.recorder.commands('press-01', OP.DISPATCH);

/** A machine that prepares its jobs, whose replies come only from the test. */
async function readyJob(log: RecordingLog): Promise<{ rowId: string; cmdId: string }> {
  rig = await startRig({ autoArriveAtEntry: false }, { replyTimeoutMs: 500 }, DEFAULT_LINE, { codec: genericCodec({ root: ROOT, dispatchOn: DISPATCH_ON.ARRIVAL }), log });
  rig.line.config('press-01', { replyMode: 'drop' });
  snapshot('boot-1', []);
  await sleep(30);
  const row = rig.park('U1', null, 'press-01');
  scanIn('U1');
  await until(() => dispatches().length);
  const cmdId = dispatchCommandId(row.id);
  reply(cmdId, REPLY_STATUS.ACCEPTED, { preparing: true });
  await until(() => log.of(GATEWAY_LOG.DISPATCH_PREPARING).length);
  reply(cmdId, REPLY_STATUS.COMPLETED);
  await rig.lt.ended(row.id);
  return { rowId: row.id, cmdId };
}

describe('a machine that restarts after its job is ready, on arrival dispatch', () => {
  it('is sent the job again under the same command id, as a retry, with no verb on the ended row', async () => {
    const log = new RecordingLog();
    const { rowId, cmdId } = await readyJob(log);
    snapshot('boot-2', []);
    await until(() => dispatches().length === 2);
    const again = dispatches()[1];
    expect(again).toMatchObject({ cmdId, retry: true, attempt: 2, args: { jobId: 'U1-press-01' } });
    expect(again.issuedAt).toBe(dispatches()[0].issuedAt);
    reply(cmdId, REPLY_STATUS.ACCEPTED, { preparing: true });
    await until(() => log.of(GATEWAY_LOG.DISPATCHED).some((e) => e.resent));
    expect(rig.lt.rows.get(rowId)).toMatchObject({ status: 'resolved' });
    expect(log.of(GATEWAY_LOG.VERB_INVALID)).toHaveLength(0);
  });

  it('is not sent a job its new snapshot still lists', async () => {
    const log = new RecordingLog();
    await readyJob(log);
    snapshot('boot-2', [{ jobId: 'U1-press-01' }]);
    await sleep(80);
    expect(dispatches()).toHaveLength(1);
    expect(log.of(GATEWAY_LOG.DISPATCH_UNRECOVERABLE)).toHaveLength(0);
  });

  it('remembers nothing of a job once its units left the machine', async () => {
    const log = new RecordingLog();
    await readyJob(log);
    publish(CHANNEL.JOB, { event: 'released', jobId: 'U1-press-01', unitId: 'U1', orderRef: 'ORD-1', recipe: null });
    await sleep(30);
    snapshot('boot-2', []);
    await sleep(80);
    expect(dispatches()).toHaveLength(1);
    expect(log.of(GATEWAY_LOG.DISPATCH_UNRECOVERABLE)).toHaveLength(0);
  });

  it('logs a lost job as unrecoverable when a later gateway holds no memory of it', async () => {
    const log = new RecordingLog();
    await readyJob(log);
    await rig.gateway.stop();
    rig.gateway = await rig.startGateway();
    snapshot('boot-1', [{ jobId: 'U1-press-01' }]);
    await sleep(30);
    snapshot('boot-2', []);
    await until(() => log.of(GATEWAY_LOG.DISPATCH_UNRECOVERABLE).length);
    expect(log.of(GATEWAY_LOG.DISPATCH_UNRECOVERABLE)[0]).toMatchObject({ machine: 'press-01', jobs: ['U1-press-01'] });
    expect(dispatches()).toHaveLength(1);
  });
});
