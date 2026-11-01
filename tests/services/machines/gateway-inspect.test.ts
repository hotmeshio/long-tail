import { describe, it, expect, afterEach } from 'vitest';

import { CHANNEL, LEVEL, alarmTopic, buildEnvelope, machineTopic } from '../../../lib/machines/protocol';
import { identOf } from '../../../lib/machines/line';
import { ROW_TYPE } from '../../../services/machines/contracts';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ROOT, sleep } from '../../helpers/machine-line-fixtures';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

let rig: LineRig;
afterEach(async () => rig?.stop());

const PRESS = identOf(DEFAULT_LINE, 'press-01');

describe('inspecting a message (dry run)', () => {
  it('plans an alarm as a row for a person and creates none', async () => {
    rig = await startRig();
    const rows = rig.lt.rows.size;
    const result = rig.gateway.inspect({
      topic: alarmTopic(ROOT, PRESS, 'A-1'),
      payload: JSON.stringify(buildEnvelope(PRESS, {
        alarmId: 'A-1', code: 'F-101', level: LEVEL.CRITICAL, text: 'Platen over temperature', active: true, raisedAt: '2026-01-01T00:00:00.000Z',
        clearedAt: null, clearedBy: null, ackedBy: null, ackedAt: null, zone: null, autoClears: false, action: null, jobId: null,
      })),
      retained: true,
    });
    expect(result).toMatchObject({ kind: 'alarm', event: 'raised', violations: [] });
    expect(result.summary).toMatch(/^alarm raised A-1 critical/);
    expect(result.actions).toEqual(expect.arrayContaining([expect.objectContaining({ verb: 'create-row', detail: `${ROW_TYPE.ALARM} for press-01` })]));
    expect(result.inspections).toHaveLength(1);
    await sleep(20);
    expect(rig.lt.rows.size).toBe(rows);
    expect(rig.gateway.state.alarms.size).toBe(0);
    expect(rig.lt.ofType(ROW_TYPE.ALARM)).toEqual([]);
  });

  it('a message with no row yet waits; one that breaks the contract says how', async () => {
    rig = await startRig();
    const waiting = rig.gateway.inspect({
      topic: machineTopic(ROOT, PRESS, CHANNEL.JOB),
      payload: JSON.stringify(buildEnvelope(PRESS, { event: 'arrived', jobId: 'U7-press-01', unitId: 'U7', orderRef: 'ORD-1', recipe: null, carrierId: 'CR-U7', peer: null })),
    });
    expect(waiting).toMatchObject({ kind: 'job', event: 'arrived', actions: [{ verb: 'none', detail: 'waiting for its row (delivery 1)' }] });
    expect(rig.gateway.state.heldAt('press-01')).toEqual([]);

    const broken = rig.gateway.inspect({
      topic: machineTopic(ROOT, PRESS, CHANNEL.JOB),
      payload: JSON.stringify(buildEnvelope(PRESS, { event: 'started', jobId: 'U7-press-01', orderRef: 'ORD-1', recipe: null, carrierId: null, peer: null })),
    });
    expect(broken.violations).toEqual(expect.arrayContaining([expect.stringMatching(/started without a unitId/)]));
  });

  it('a topic that is not a machine\'s, and a payload that is not JSON, read as such', async () => {
    rig = await startRig();
    expect(rig.gateway.inspect({ topic: `${ROOT}/site-1/line-1/stray`, payload: 'x' })).toMatchObject({ kind: null, summary: 'not a machine message', actions: [{ verb: 'none' }] });
    const garbled = rig.gateway.inspect({ topic: machineTopic(ROOT, PRESS, CHANNEL.JOB), payload: 'not json' });
    expect(garbled.kind).toBe('job');
    expect(garbled.violations).toContain('not a JSON object');
  });
});
