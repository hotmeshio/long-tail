import { describe, it, expect, afterEach } from 'vitest';

import { ROW_TYPE } from '../../../services/machines/contracts';
import { GATEWAY_LOG } from '../../../services/machines/gateway/log';
import { RecordingLog } from '../../../services/machines/testing/recording-log';
import { CHANNEL, OP, alarmTopic, buildEnvelope, machineTopic } from '../../../lib/machines/protocol';
import { identOf } from '../../../lib/machines/line';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ROOT, sleep, until } from '../../helpers/machine-line-fixtures';

let rig: LineRig;
afterEach(async () => rig?.stop());

const rowsOf = (type: string) => rig.lt.ofType(type);

async function restartGateway(during?: () => Promise<void>): Promise<void> {
  await rig.gateway.stop();
  await during?.();
  rig.gateway = await rig.startGateway();
}

describe('recovery: a gateway restart keeps its own rows', () => {
  it('an alarm cleared while no gateway listened resolves its row on the next start', async () => {
    rig = await startRig();
    const alarmId = await rig.line.fault('press-01', { code: 'F-101' });
    const row = await until(() => rowsOf(ROW_TYPE.ALARM)[0]);
    await restartGateway(() => rig.line.clearAlarm('press-01', { alarmId, by: 'tech-1' }).then(() => undefined));
    const ended = await rig.lt.ended(row.id);
    expect(ended.resolver_payload).toMatchObject({ decision: 'cleared' });
  });

  it('an alarm still active after the restart resolves when it clears later', async () => {
    rig = await startRig();
    const alarmId = await rig.line.fault('press-01', { code: 'F-101' });
    const row = await until(() => rowsOf(ROW_TYPE.ALARM)[0]);
    await restartGateway();
    await sleep(20);
    expect(rig.lt.rows.get(row.id)!.status).toBe('pending');
    expect(rowsOf(ROW_TYPE.ALARM)).toHaveLength(1);
    await rig.line.clearAlarm('press-01', { alarmId, by: 'tech-2' });
    expect((await rig.lt.ended(row.id)).resolver_payload).toMatchObject({ decision: 'cleared', clearedBy: 'tech-2' });
  });

  it('a machine back online while no gateway listened resolves its offline row', async () => {
    rig = await startRig({}, { offlineDebounceMs: 5 });
    await rig.line.network('press-01', { mode: 'drop' });
    const row = await until(() => rowsOf(ROW_TYPE.MACHINE_OFFLINE)[0], 2_000);
    await restartGateway(() => rig.line.network('press-01', { mode: 'restore' }));
    expect((await rig.lt.ended(row.id)).resolver_payload).toMatchObject({ decision: 'restored' });
  });

  it('an alarm id the machine reuses with a new raise time is a new alarm; ending the old row acknowledges nothing', async () => {
    rig = await startRig();
    const ident = identOf(DEFAULT_LINE, 'press-01');
    const raise = (raisedAt: string) => rig.broker.publish(alarmTopic(ROOT, ident, 'A-7'), JSON.stringify(buildEnvelope(ident, {
      alarmId: 'A-7', code: 'F-101', level: 'critical', text: 'Platen over temperature', active: true, raisedAt,
      clearedAt: null, clearedBy: null, ackedBy: null, ackedAt: null, zone: null, autoClears: false, action: null, jobId: null,
    })), true);
    raise('2026-01-01T00:00:00.000Z');
    const first = await until(() => rowsOf(ROW_TYPE.ALARM)[0]);
    raise('2026-01-01T00:00:00.000Z');
    await sleep(20);
    expect(rowsOf(ROW_TYPE.ALARM)).toHaveLength(1);
    raise('2026-01-02T00:00:00.000Z');
    const second = await until(() => rowsOf(ROW_TYPE.ALARM).find((r) => r.id !== first.id));
    expect((await rig.lt.ended(first.id)).resolver_payload).toMatchObject({ decision: 'cleared' });
    await sleep(20);
    await rig.gateway.idle();
    expect(rig.recorder.commands('press-01', OP.ACKNOWLEDGE_ALARM)).toEqual([]);

    // The machine's clear still ends the new raise's row.
    rig.broker.publish(alarmTopic(ROOT, ident, 'A-7'), '', true);
    expect((await rig.lt.ended(second.id)).resolver_payload).toMatchObject({ decision: 'cleared' });
  });
});

describe('recovery: the line misbehaves', () => {
  for (const result of ['hold', 'scrap', 'rework'] as const) {
    it(`units the sender finishes as ${result} fail the handoff as sender-rejected`, async () => {
      rig = await startRig();
      rig.line.arm('press-01', { result, reason: `QA-${result}` });
      await rig.handoff('U1', null, 'press-01');
      const ended = await rig.handoff('U1', 'press-01', 'cut-01');
      expect(ended.resolver_payload).toMatchObject({ received: false, errorCode: 'sender-rejected' });
      expect(ended.resolver_payload!.detail).toMatch(new RegExp(`QA-${result}`));
    });
  }

  it('an e-stop at the receiver holds the handoff open until the reset, then it completes', async () => {
    rig = await startRig({ transferSec: 20 });
    await rig.handoff('U1', null, 'press-01');
    const row = rig.park('U1', 'press-01', 'cut-01');
    await until(() => rig.lt.calls.some((c) => c.verb === 'claim' && c.id === row.id));
    await rig.line.emergencyStop('cut-01');
    await sleep(60);
    expect(rig.lt.rows.get(row.id)!.status).toBe('pending');
    await rig.line.reset('cut-01', { by: 'tech-1' });
    expect((await rig.lt.ended(row.id, 2_000)).resolver_payload).toMatchObject({ received: true });
  });

  it('one unit of two failing in transfer fails the handoff, naming that unit, with the other unit\'s arrival kept', async () => {
    rig = await startRig({ transferSec: 50 });
    await rig.handoff(['U1', 'U2'], null, 'press-01');
    const row = rig.park(['U1', 'U2'], 'press-01', 'cut-01');
    await until(() => rig.recorder.jobs('press-01', 'released').some((j) => j.unitId === 'U1'), 2_000);
    rig.line.armTransfer('cut-01', { fault: 'unreadable' });
    const ended = await rig.lt.ended(row.id, 2_000);
    expect(ended.resolver_payload).toMatchObject({ received: false, errorCode: 'unreadable-id', unitId: 'U2' });
    expect(ended.items.map((i) => i.itemKey)).toContain('arrived:U1');
  });
});

describe('recovery: Long Tail and the contract', () => {
  it('a Long Tail outage on a verb redelivers the message until the verb lands', async () => {
    rig = await startRig();
    rig.lt.failNext('accumulate', 2);
    const ended = await rig.handoff('U1', null, 'press-01');
    expect(ended.resolver_payload).toMatchObject({ received: true });
  });

  it('a message that breaks the contract is still acted on, and logged once across redeliveries', async () => {
    const log = new RecordingLog();
    rig = await startRig({ autoArriveAtEntry: false }, {}, DEFAULT_LINE, { log });
    const row = rig.park('U1', null, 'press-01');
    await until(() => rig.lt.calls.some((c) => c.verb === 'claim' && c.id === row.id));
    rig.lt.failNext('accumulate', 1);
    const ident = identOf(DEFAULT_LINE, 'press-01');
    const arrival = buildEnvelope(ident, { event: 'arrived', jobId: 'U1-press-01', unitId: 'U1', orderRef: 'ORD-1', recipe: null, carrierId: 'CR-U1', peer: 7 });
    rig.broker.publish(machineTopic(ROOT, ident, CHANNEL.JOB), JSON.stringify(arrival));
    expect((await rig.lt.ended(row.id)).resolver_payload).toMatchObject({ received: true });
    expect(log.of(GATEWAY_LOG.CONTRACT_VIOLATION)).toHaveLength(1);
  });
});

describe('recovery: a restart while a machine holds the row', () => {
  it('keeps the claim, sends no second dispatch, and a sender reject still closes the row as the claimant', async () => {
    rig = await startRig();
    rig.line.config('press-01', { cycleSec: 150 });
    rig.line.arm('press-01', { result: 'reject', reason: 'WEAK' });
    await rig.handoff('U1', null, 'press-01');
    const row = rig.park('U1', 'press-01', 'cut-01');
    await until(() => rig.lt.calls.some((c) => c.verb === 'claim' && c.id === row.id));
    await restartGateway();
    const ended = await rig.lt.ended(row.id, 2_000);
    expect(ended).toMatchObject({ status: 'resolved', resolved_by: 'cut-01' });
    expect(ended.resolver_payload).toMatchObject({ errorCode: 'sender-rejected', reportedBy: 'press-01' });
    expect(rig.recorder.commands('cut-01', 'dispatch')).toHaveLength(1);
  });
});
