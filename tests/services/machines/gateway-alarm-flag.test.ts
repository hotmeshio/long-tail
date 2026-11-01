import { describe, it, expect, afterEach } from 'vitest';

import { ROW_TYPE } from '../../../services/machines/contracts';
import { CHANNEL, OP, alarmTopic, buildEnvelope, machineTopic } from '../../../lib/machines/protocol';
import { identOf } from '../../../lib/machines/line';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ROOT, sleep, until } from '../../helpers/machine-line-fixtures';

let rig: LineRig;
afterEach(async () => rig?.stop());

const ident = identOf(DEFAULT_LINE, 'press-01');
const alarmRows = () => rig.lt.ofType(ROW_TYPE.ALARM);

function raise(alarmId: string, level: string, extra: Record<string, unknown> = {}): void {
  rig.broker.publish(alarmTopic(ROOT, ident, alarmId), JSON.stringify(buildEnvelope(ident, {
    alarmId, code: 'W-7', level, text: 'Bin low', active: true, raisedAt: '2026-01-01T00:00:00.000Z',
    clearedAt: null, clearedBy: null, ackedBy: null, ackedAt: null, zone: null, autoClears: false, action: null, jobId: null, ...extra,
  })), true);
}

function snapshot(body: Record<string, unknown>): void {
  rig.broker.publish(machineTopic(ROOT, ident, CHANNEL.SNAPSHOT), JSON.stringify(buildEnvelope(ident, { mode: 'idle', enabled: true, jobs: [], alarms: [], ...body })), true);
}

describe('an alarm that asks for a person', () => {
  it('raises a row at the level the machine said, while a plain warning raises none', async () => {
    rig = await startRig();
    raise('W-1', 'warning');
    await sleep(60);
    expect(alarmRows()).toHaveLength(0);
    raise('W-2', 'warning', { needsPerson: true });
    const row = await until(() => alarmRows()[0]);
    expect(row).toMatchObject({ subtype: 'warning', status: 'pending' });
    expect(row.metadata).toMatchObject({ alarmId: 'W-2', level: 'warning' });
  });
});

describe('a snapshot without a boot id', () => {
  it('keeps the boot id the machine last gave and asks for nothing again', async () => {
    rig = await startRig();
    snapshot({ bootId: 'boot-1', software: '1.0' });
    await until(() => rig.gateway.state.project(DEFAULT_LINE).machines[0].bootId === 'boot-1');
    const before = rig.recorder.commands('press-01', OP.DISPATCH).length;
    snapshot({});
    await rig.gateway.idle();
    await sleep(30);
    const press = rig.gateway.state.project(DEFAULT_LINE).machines[0];
    expect(press.bootId).toBe('boot-1');
    expect(press.software).toBe('1.0');
    expect(rig.recorder.commands('press-01', OP.DISPATCH)).toHaveLength(before);
  });
});
