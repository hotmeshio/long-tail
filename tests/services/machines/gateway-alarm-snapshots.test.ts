import { describe, it, expect, afterEach } from 'vitest';

import { ROW_TYPE } from '../../../services/machines/contracts';
import { CHANNEL, alarmTopic, buildEnvelope, genericCodec, machineTopic } from '../../../lib/machines/protocol';
import { identOf } from '../../../lib/machines/line';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ROOT, sleep, until } from '../../helpers/machine-line-fixtures';

let rig: LineRig;
afterEach(async () => rig?.stop());

// Machines whose alarms are not retained on the broker: their snapshot lists the active ones.
const unretained = { codec: { ...genericCodec({ root: ROOT }), retainedAlarms: false } };
const ident = identOf(DEFAULT_LINE, 'press-01');
const alarmRows = () => rig.lt.ofType(ROW_TYPE.ALARM);

function raise(alarmId: string): void {
  rig.broker.publish(alarmTopic(ROOT, ident, alarmId), JSON.stringify(buildEnvelope(ident, {
    alarmId, code: 'F-101', level: 'critical', text: 'Platen over temperature', active: true, raisedAt: '2026-01-01T00:00:00.000Z',
    clearedAt: null, clearedBy: null, ackedBy: null, ackedAt: null, zone: null, autoClears: false, action: null, jobId: null,
  })), false);
}

function snapshot(alarms: string[]): void {
  rig.broker.publish(machineTopic(ROOT, ident, CHANNEL.SNAPSHOT), JSON.stringify(buildEnvelope(ident, {
    bootId: 'boot-1', software: '1.0', mode: 'idle', enabled: true, recipe: null, jobs: [], alarms, cycles: 0,
  })), true);
}

describe('alarms a machine does not retain', () => {
  it('stay open across a gateway restart, which finds none of them retained', async () => {
    rig = await startRig({}, {}, DEFAULT_LINE, unretained);
    raise('A-1');
    const row = await until(() => alarmRows()[0]);
    await rig.gateway.stop();
    rig.gateway = await rig.startGateway();
    await rig.gateway.idle();
    await sleep(20);
    expect(rig.lt.rows.get(row.id)!.status).toBe('pending');
  });

  it('clear when the machine\'s snapshot no longer lists them, and stay open while it does', async () => {
    rig = await startRig({}, {}, DEFAULT_LINE, unretained);
    raise('A-1');
    const row = await until(() => alarmRows()[0]);
    snapshot(['A-1']);
    await rig.gateway.idle();
    await sleep(20);
    expect(rig.lt.rows.get(row.id)!.status).toBe('pending');
    snapshot([]);
    const ended = await rig.lt.ended(row.id);
    expect(ended.resolver_payload).toMatchObject({ decision: 'cleared' });
    expect(ended.resolver_payload!.note).toMatch(/snapshot no longer lists it/);
  });
});
