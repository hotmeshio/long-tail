import { describe, it, expect, afterEach } from 'vitest';

import { CHANNEL, DISPATCH_ON, OP, REPLY_STATUS, buildEnvelope, genericCodec, machineTopic } from '../../../lib/machines/protocol';
import { identOf } from '../../../lib/machines/line';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { HANDOFF_ERROR, dispatchCommandId } from '../../../services/machines/contracts';
import { GATEWAY_LOG } from '../../../services/machines/gateway/log';
import { RecordingLog } from '../../../services/machines/testing/recording-log';
import { ROOT, sleep, until } from '../../helpers/machine-line-fixtures';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';

let rig: LineRig;
afterEach(async () => rig?.stop());

const onArrival = (perDispatch: number | null = null) => ({ codec: genericCodec({ root: ROOT, dispatchOn: DISPATCH_ON.ARRIVAL, unitsPerDispatch: perDispatch }) });

/** The machine's own reply to a dispatch command, as one that prepares its jobs sends it. */
function reply(cmdId: string, status: string, reason: string, extra: Record<string, unknown> = {}): void {
  const ident = identOf(DEFAULT_LINE, 'press-01');
  rig.broker.publish(machineTopic(ROOT, ident, CHANNEL.REPLY), JSON.stringify(buildEnvelope(ident, { cmdId, status, reason, ...extra })));
}

function scanIn(unitId: string, jobId = `${unitId}-press-01`): void {
  const ident = identOf(DEFAULT_LINE, 'press-01');
  const body = { event: 'arrived', jobId, unitId, orderRef: 'ORD-1', recipe: null, carrierId: `CR-${unitId}`, visitId: `visit-${unitId}` };
  rig.broker.publish(machineTopic(ROOT, ident, CHANNEL.JOB), JSON.stringify(buildEnvelope(ident, body)));
}

const dispatches = () => rig.recorder.commands('press-01', OP.DISPATCH);

/** A machine whose replies the gateway hears only from these tests. */
async function silentMock(log?: RecordingLog, perDispatch: number | null = null): Promise<void> {
  rig = await startRig({ autoArriveAtEntry: false }, { replyTimeoutMs: 500 }, DEFAULT_LINE, { ...onArrival(perDispatch), ...(log ? { log } : {}) });
  rig.line.config('press-01', { replyMode: 'drop' });
}

describe('dispatch on arrival: a machine that prepares its jobs', () => {
  it('keeps the handoff open, claimed, until the machine says the job is ready', async () => {
    const log = new RecordingLog();
    await silentMock(log);
    const row = rig.park('U1', null, 'press-01');
    scanIn('U1');
    await until(() => dispatches().length);
    reply(dispatchCommandId(row.id), REPLY_STATUS.ACCEPTED, 'recorded; fetching the artifact', { preparing: true });
    await until(() => log.of(GATEWAY_LOG.DISPATCH_PREPARING).length);
    expect(rig.lt.rows.get(row.id)).toMatchObject({ status: 'pending', assigned_to: 'press-01' });
    reply(dispatchCommandId(row.id), REPLY_STATUS.COMPLETED, 'artifact verified');
    const ended = await rig.lt.ended(row.id);
    expect(ended).toMatchObject({ status: 'resolved', resolved_by: 'press-01' });
    expect(ended.resolver_payload).toMatchObject({ received: true, receiver: 'press-01', units: ['U1'] });
  });

  it('a ready that comes while the claim is still out completes the handoff once the claim is in', async () => {
    const log = new RecordingLog();
    await silentMock(log);
    const claim = rig.lt.claim.bind(rig.lt);
    rig.lt.claim = async (as, id) => {
      await sleep(200);
      return claim(as, id);
    };
    const row = rig.park('U1', null, 'press-01');
    scanIn('U1');
    await until(() => dispatches().length);
    reply(dispatchCommandId(row.id), REPLY_STATUS.ACCEPTED, 'recorded', { preparing: true });
    reply(dispatchCommandId(row.id), REPLY_STATUS.COMPLETED, 'ready at once');
    const ended = await rig.lt.ended(row.id);
    expect(ended).toMatchObject({ status: 'resolved', resolved_by: 'press-01', assigned_to: 'press-01' });
    expect(ended.resolver_payload).toMatchObject({ received: true, units: ['U1'] });
    expect(log.of(GATEWAY_LOG.VERB_INVALID)).toEqual([]);
    expect(log.of(GATEWAY_LOG.DISPATCH_PREPARING)).toEqual([]);
  });

  it('a failure to prepare after acceptance ends the handoff itself as dispatch-failed', async () => {
    await silentMock();
    const row = rig.park('U1', null, 'press-01');
    scanIn('U1');
    await until(() => dispatches().length);
    reply(dispatchCommandId(row.id), REPLY_STATUS.ACCEPTED, 'recorded', { preparing: true });
    await until(() => rig.lt.rows.get(row.id)?.assigned_to);
    reply(dispatchCommandId(row.id), REPLY_STATUS.FAILED, 'artifact checksum mismatch', { code: 'artifact' });
    const ended = await rig.lt.ended(row.id);
    expect(ended).toMatchObject({ status: 'resolved', resolved_by: 'press-01' });
    expect(ended.resolver_payload).toMatchObject({ received: false, errorCode: HANDOFF_ERROR.DISPATCH_FAILED, code: 'artifact' });
    expect(ended.resolver_payload!.detail).toMatch(/checksum/);
  });

  it('a retry for a unit the machine still holds goes out with no second scan', async () => {
    await silentMock();
    const row = rig.park('U1', null, 'press-01');
    scanIn('U1');
    await until(() => dispatches().length === 1);
    reply(dispatchCommandId(row.id), REPLY_STATUS.ACCEPTED, 'recorded', { preparing: true });
    await until(() => rig.lt.rows.get(row.id)?.assigned_to);
    reply(dispatchCommandId(row.id), REPLY_STATUS.FAILED, 'controller lost the recipe', { code: 'RECOVERY_REQUIRED' });
    await rig.lt.ended(row.id);
    const again = rig.park('U1', null, 'press-01', 2);
    await until(() => dispatches().length === 2);
    expect(dispatches()[1].cmdId).toBe(dispatchCommandId(again.id));
    expect(dispatches()[1].args.units[0].arrival).toMatchObject({ unitId: 'U1', visitId: 'visit-U1' });
    reply(dispatchCommandId(again.id), REPLY_STATUS.ACCEPTED, 'queued');
    const ended = await rig.lt.ended(again.id);
    expect(ended.resolver_payload).toMatchObject({ received: true, units: ['U1'] });
  });

  it('an acceptance that says nothing of preparing completes the handoff at once', async () => {
    await silentMock();
    const row = rig.park('U1', null, 'press-01');
    scanIn('U1');
    await until(() => dispatches().length);
    reply(dispatchCommandId(row.id), REPLY_STATUS.ACCEPTED, 'queued');
    const ended = await rig.lt.ended(row.id);
    expect(ended.resolver_payload).toMatchObject({ received: true });
  });

  it('with one job per unit, the handoff is received once every job is ready', async () => {
    await silentMock(undefined, 1);
    const row = rig.park(['U1', 'U2'], null, 'press-01');
    scanIn('U1');
    scanIn('U2', 'U1-press-01');
    await until(() => dispatches().length === 2);
    const [first, second] = dispatches().map((d) => d.cmdId);
    reply(first, REPLY_STATUS.ACCEPTED, 'recorded', { preparing: true });
    reply(second, REPLY_STATUS.ACCEPTED, 'recorded', { preparing: true });
    await until(() => rig.lt.rows.get(row.id)?.assigned_to);
    reply(first, REPLY_STATUS.COMPLETED, 'ready');
    await sleep(60);
    expect(rig.lt.rows.get(row.id)?.status).toBe('pending');
    reply(second, REPLY_STATUS.COMPLETED, 'ready');
    const ended = await rig.lt.ended(row.id);
    expect(ended.resolver_payload).toMatchObject({ received: true, units: ['U1', 'U2'] });
  });
});
