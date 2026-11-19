import { describe, it, expect, afterEach } from 'vitest';

import { ROW_TYPE, alarmSignalKey } from '../../../services/machines/contracts';
import { ALARM_IDS, alarmTopic, buildEnvelope, genericCodec } from '../../../lib/machines/protocol';
import { identOf } from '../../../lib/machines/line';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ROOT, sleep, until } from '../../helpers/machine-line-fixtures';

let rig: LineRig;
afterEach(async () => rig?.stop());

const ident = identOf(DEFAULT_LINE, 'press-01');
const alarmRows = () => rig.lt.ofType(ROW_TYPE.ALARM);
const occurrence = { codec: { ...genericCodec({ root: ROOT }), alarmIds: ALARM_IDS.OCCURRENCE } };
const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-01-01T01:00:00.000Z';

function alarm(alarmId: string, active: boolean, raisedAt: string, retained = true): void {
  rig.broker.publish(alarmTopic(ROOT, ident, alarmId), JSON.stringify(buildEnvelope(ident, {
    alarmId, code: 'F-101', level: 'critical', text: 'Platen over temperature', active, raisedAt,
    clearedAt: null, clearedBy: null, ackedBy: null, ackedAt: null, zone: null, autoClears: false, action: null, jobId: null,
  })), retained);
}

async function settle(): Promise<void> {
  await rig.gateway.idle();
  await sleep(30);
}

describe('alarm rows are keyed', () => {
  it('under recurring ids, on the alarm id and its raise time', async () => {
    rig = await startRig();
    alarm('A-1', true, T1);
    await until(() => alarmRows()[0]);
    const create = rig.lt.calls.find((c) => c.verb === 'create');
    expect(create!.id).toBe(alarmSignalKey(ident.siteId, ident.lineId, 'press-01', 'A-1', T1));
  });

  it('a raise replayed after its row ended raises nothing, and its clear resolves nothing', async () => {
    rig = await startRig();
    alarm('A-1', true, T1);
    const row = await until(() => alarmRows()[0]);
    alarm('A-1', false, T1);
    await rig.lt.ended(row.id);
    alarm('A-1', true, T1, false);
    await settle();
    expect(alarmRows()).toHaveLength(1);
    expect(rig.gateway.state.alarms.size).toBe(0);
  });

  it('a raise replayed to a later gateway, after its row ended, raises nothing', async () => {
    rig = await startRig();
    alarm('A-1', true, T1);
    const row = await until(() => alarmRows()[0]);
    alarm('A-1', false, T1);
    await rig.lt.ended(row.id);
    await rig.gateway.stop();
    rig.gateway = await rig.startGateway();
    alarm('A-1', true, T1, false);
    await settle();
    expect(alarmRows()).toHaveLength(1);
    expect(rig.lt.rows.get(row.id)!.status).toBe('resolved');
  });

  it('a recurring id raised again at a new time is a new row', async () => {
    rig = await startRig();
    alarm('A-1', true, T1);
    const first = await until(() => alarmRows()[0]);
    alarm('A-1', true, T2);
    await until(() => alarmRows().length === 2);
    expect((await rig.lt.ended(first.id)).resolver_payload).toMatchObject({ decision: 'cleared' });
  });
});

describe('alarm ids that name one occurrence', () => {
  it('key the row on the alarm id alone', async () => {
    rig = await startRig({}, {}, DEFAULT_LINE, occurrence);
    alarm('A-1', true, T1);
    await until(() => alarmRows()[0]);
    const create = rig.lt.calls.find((c) => c.verb === 'create');
    expect(create!.id).toBe(alarmSignalKey(ident.siteId, ident.lineId, 'press-01', 'A-1'));
  });

  it('raise nothing for a second raise time, open or after a person resolved the row', async () => {
    rig = await startRig({}, {}, DEFAULT_LINE, occurrence);
    alarm('A-1', true, T1);
    const row = await until(() => alarmRows()[0]);
    alarm('A-1', true, T2, false);
    await settle();
    expect(alarmRows()).toHaveLength(1);
    expect(rig.lt.rows.get(row.id)!.status).toBe('pending');
    rig.lt.personResolves(row.id, { decision: 'acknowledged' });
    await settle();
    alarm('A-1', true, T2, false);
    await settle();
    expect(alarmRows()).toHaveLength(1);
  });

  it('raise nothing when replayed to a later gateway after the row ended', async () => {
    rig = await startRig({}, {}, DEFAULT_LINE, occurrence);
    alarm('A-1', true, T1);
    const row = await until(() => alarmRows()[0]);
    alarm('A-1', false, T1);
    await rig.lt.ended(row.id);
    await rig.gateway.stop();
    rig.gateway = await rig.startGateway();
    alarm('A-1', true, T2, false);
    await settle();
    expect(alarmRows()).toHaveLength(1);
    expect(rig.gateway.state.alarms.size).toBe(0);
  });
});
