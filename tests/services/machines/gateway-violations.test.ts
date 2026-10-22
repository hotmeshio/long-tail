import { describe, it, expect, afterEach } from 'vitest';

import { CHANNEL, alarmTopic, buildEnvelope, genericCodec, machineTopic } from '../../../lib/machines/protocol';
import { identOf } from '../../../lib/machines/line';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { ROW_TYPE } from '../../../services/machines/contracts';
import { ROOT, sleep, until } from '../../helpers/machine-line-fixtures';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';

let rig: LineRig;
afterEach(async () => rig?.stop());

const ident = identOf(DEFAULT_LINE, 'press-01');
const rowsOf = (type: string) => [...rig.lt.rows.values()].filter((r) => r.type === type);

/** An arrival that names its unit but breaks the contract: no order or recipe. */
const broken = buildEnvelope(ident, { event: 'arrived', jobId: 'U1-press-01', unitId: 'U1', carrierId: 'CR-U1' });
const send = () => rig.broker.publish(machineTopic(ROOT, ident, CHANNEL.JOB), JSON.stringify(broken));

describe('contract violations', () => {
  it('under a strict codec a broken message is held for a person, once, and never acted on', async () => {
    rig = await startRig({ autoArriveAtEntry: false }, {}, DEFAULT_LINE, { codec: { ...genericCodec({ root: ROOT }), strict: true } });
    const row = rig.park('U1', null, 'press-01');
    send();
    send();
    const held = await until(() => rowsOf(ROW_TYPE.CONTRACT_VIOLATION)[0], 2_000);
    await sleep(30);
    expect(rowsOf(ROW_TYPE.CONTRACT_VIOLATION)).toHaveLength(1);
    expect(held).toMatchObject({ role: 'line-operator', metadata: { machineId: 'press-01', kind: 'job', messageId: broken.id } });
    expect(held.metadata.violations.join(' ')).toMatch(/orderRef/);
    expect(JSON.parse(held.escalation_payload!).id).toBe(broken.id);
    expect(rig.lt.rows.get(row.id)!.items).toEqual([]);
  });

  it('by default the known fields are acted on and the violation is only logged', async () => {
    rig = await startRig({ autoArriveAtEntry: false });
    const row = rig.park('U1', null, 'press-01');
    send();
    await until(() => rig.lt.rows.get(row.id)!.items.length, 2_000);
    expect(rowsOf(ROW_TYPE.CONTRACT_VIOLATION)).toEqual([]);
  });
});

describe('alarm codes from a catalog', () => {
  it('an alarm naming its catalog edition carries it as a lookup, so the row reads the code\'s meaning', async () => {
    rig = await startRig();
    rig.broker.publish(alarmTopic(ROOT, ident, 'A-9'), JSON.stringify(buildEnvelope(ident, {
      alarmId: 'A-9', code: '4021', level: 'critical', text: 'Glue reservoir empty', active: true, raisedAt: '2026-01-01T00:00:00.000Z',
      clearedAt: null, clearedBy: null, ackedBy: null, ackedAt: null, zone: null, autoClears: false, action: null, jobId: null,
      catalog: { domain: 'alarm-catalog', key: 'press', version: 3 },
    })), true);
    const alarm = await until(() => rowsOf(ROW_TYPE.ALARM)[0], 2_000);
    expect(JSON.parse(alarm.envelope!)).toEqual({ lookups: [{ domain: 'alarm-catalog', key: 'press', version: 3 }] });
  });
});
