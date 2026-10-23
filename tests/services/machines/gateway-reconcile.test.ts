import { describe, it, expect, afterEach } from 'vitest';

import { CHANNEL, buildEnvelope, machineTopic } from '../../../lib/machines/protocol';
import { identOf } from '../../../lib/machines/line';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { dispatchCommandId } from '../../../services/machines/contracts';
import { GATEWAY_LOG } from '../../../services/machines/gateway/log';
import { RecordingLog } from '../../../services/machines/testing/recording-log';
import { ROOT, until } from '../../helpers/machine-line-fixtures';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';

let rig: LineRig;
afterEach(async () => rig?.stop());

/** A second reply to a dispatch, as a machine that prepares its jobs sends it. */
function laterReply(rowId: string, status: string, reason: string): void {
  const ident = identOf(DEFAULT_LINE, 'press-01');
  rig.broker.publish(machineTopic(ROOT, ident, CHANNEL.REPLY), JSON.stringify(buildEnvelope(ident, { cmdId: dispatchCommandId(rowId), status, reason })));
}

describe('dispatch: silence is not a refusal', () => {
  it('a machine that took the job but whose replies were lost is asked what it holds, and keeps the job', async () => {
    const log = new RecordingLog();
    rig = await startRig({ autoArriveAtEntry: false }, { replyTimeoutMs: 30 }, DEFAULT_LINE, { log });
    rig.line.config('press-01', { replyMode: 'drop' });
    const row = rig.park('U1', null, 'press-01');
    await until(() => rig.lt.rows.get(row.id)?.assigned_to, 2_000);
    expect(rig.lt.rows.get(row.id)).toMatchObject({ status: 'pending', assigned_to: 'press-01' });
    expect(log.of(GATEWAY_LOG.DISPATCH_RECONCILED)[0]).toMatchObject({ machine: 'press-01', jobs: ['U1-press-01'] });
  });

  it('a machine that cannot be reached leaves the job unknown: no-reply, and the job is withdrawn', async () => {
    rig = await startRig({}, { replyTimeoutMs: 30 });
    await rig.line.network('press-01', { mode: 'drop' });
    const ended = await rig.handoff('U1', null, 'press-01');
    expect(ended.resolver_payload).toMatchObject({ received: false, errorCode: 'no-reply' });
    expect(ended.resolver_payload!.detail).toMatch(/state is unknown/);
  });
});

describe('dispatch: accepted, then ready or failed', () => {
  it('a failure after acceptance ends the handoff as dispatch-failed, resolved by the machine that held it', async () => {
    rig = await startRig({ autoArriveAtEntry: false });
    const row = rig.park('U1', null, 'press-01');
    await until(() => rig.lt.rows.get(row.id)?.assigned_to, 2_000);
    laterReply(row.id, 'failed', 'artifact checksum mismatch');
    const ended = await rig.lt.ended(row.id);
    expect(ended).toMatchObject({ status: 'resolved', resolved_by: 'press-01' });
    expect(ended.resolver_payload).toMatchObject({ received: false, errorCode: 'dispatch-failed' });
    expect(ended.resolver_payload!.detail).toMatch(/checksum/);
  });

  it('a ready reply is logged and the handoff carries on', async () => {
    const log = new RecordingLog();
    rig = await startRig({ autoArriveAtEntry: false }, {}, DEFAULT_LINE, { log });
    const row = rig.park('U1', null, 'press-01');
    await until(() => rig.lt.rows.get(row.id)?.assigned_to, 2_000);
    laterReply(row.id, 'completed', 'artifact verified');
    await until(() => log.of(GATEWAY_LOG.DISPATCH_READY).length, 2_000);
    expect(log.of(GATEWAY_LOG.DISPATCH_READY)[0]).toMatchObject({ row: row.id, machine: 'press-01' });
    expect(rig.lt.rows.get(row.id)?.status).toBe('pending');
  });
});

describe('dispatch: replies to nothing', () => {
  it('ignores a late reply for a command it never sent', async () => {
    rig = await startRig();
    laterReply('not-a-row', 'failed', 'whatever');
    await rig.gateway.idle();
    expect([...rig.lt.rows.values()]).toEqual([]);
  });
});
