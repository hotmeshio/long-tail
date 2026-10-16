import { describe, it, expect } from 'vitest';

import { CHANNEL, JOB_EVENT, alarmTopic, buildEnvelope, inspectMessage, machineTopic } from '../../../examples/workflows/machine-line/protocol';

const ROOT = 'line/v1';
const ident = { siteId: 'site-1', lineId: 'line-1', machineId: 'press-01' };
const msg = (body: Record<string, any>) => JSON.stringify(buildEnvelope(ident, body));

const JOB = { event: JOB_EVENT.STARTED, jobId: 'j1', unitId: 'U1', orderRef: 'ORD-1', recipe: { id: 'R', version: '1' }, carrierId: 'CR-1' };
const FINISHED = {
  ...JOB, event: JOB_EVENT.FINISHED, result: 'ok', reason: null, materials: [],
  measurements: [{ name: 'temp', value: 120, unit: 'C', min: 115, max: 125, ok: true }],
  startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:08.000Z', durationMs: 8000,
};

describe('contract: envelope and topics', () => {
  it('accepts a retained presence and flags one that is not retained', () => {
    const topic = machineTopic(ROOT, ident, CHANNEL.PRESENCE);
    expect(inspectMessage(ROOT, topic, msg({ online: true }), true).violations).toEqual([]);
    expect(inspectMessage(ROOT, topic, msg({ online: true }), false).violations).toContain('presence not retained');
  });

  it('flags an unknown topic, non-JSON, a mismatched source and unknown fields', () => {
    expect(inspectMessage(ROOT, `${ROOT}/site-1/line-1/press-01/bogus`, msg({})).violations).toEqual(['unknown topic']);
    const presence = machineTopic(ROOT, ident, CHANNEL.PRESENCE);
    expect(inspectMessage(ROOT, presence, 'nope').violations).toContain('not a JSON object');
    const other = JSON.stringify(buildEnvelope({ ...ident, machineId: 'cut-01' }, { online: true }));
    expect(inspectMessage(ROOT, presence, other).violations).toContain('source disagrees with the topic');
    expect(inspectMessage(ROOT, presence, msg({ online: true, extra: 1 })).violations.some((v) => v.includes('additional properties'))).toBe(true);
  });
});

describe('contract: job rules', () => {
  const topic = machineTopic(ROOT, ident, CHANNEL.JOB);

  it('accepts a complete finished record', () => {
    expect(inspectMessage(ROOT, topic, msg(FINISHED)).violations).toEqual([]);
  });

  it('requires the result, measurements and materials on finished, and a reason on a reject', () => {
    const r = inspectMessage(ROOT, topic, msg({ ...JOB, event: JOB_EVENT.FINISHED, result: 'reject' })).violations;
    expect(r).toEqual(expect.arrayContaining(['finished without measurements', 'finished without materials', 'reject without a reason']));
  });

  it('checks each measurement against its range', () => {
    const bad = { ...FINISHED, measurements: [{ name: 'temp', value: 200, unit: 'C', min: 115, max: 125, ok: true }] };
    expect(inspectMessage(ROOT, topic, msg(bad)).violations).toContain('temp: ok disagrees with min/max');
  });

  it('requires a failure on transfer-failed and only known failures', () => {
    expect(inspectMessage(ROOT, topic, msg({ ...JOB, event: JOB_EVENT.TRANSFER_FAILED })).violations).toContain('transfer-failed without a failure');
    expect(inspectMessage(ROOT, topic, msg({ ...JOB, event: JOB_EVENT.TRANSFER_FAILED, failure: 'jam', peer: 'cut-01' })).violations).toEqual([]);
    expect(inspectMessage(ROOT, topic, msg({ ...JOB, event: JOB_EVENT.TRANSFER_FAILED, failure: 'melted' })).violations.length).toBeGreaterThan(0);
  });
});

describe('contract: alarms and replies', () => {
  const alarm = {
    alarmId: 'A1', code: 'F-101', level: 'critical', text: 't', active: true, raisedAt: '2026-01-01T00:00:00.000Z',
    clearedAt: null, ackedBy: null, ackedAt: null, zone: null, autoClears: false, action: null, jobId: null,
  };

  it('ties alarmId to the topic and allows an empty retained clear', () => {
    expect(inspectMessage(ROOT, alarmTopic(ROOT, ident, 'A1'), msg(alarm), true).violations).toEqual([]);
    expect(inspectMessage(ROOT, alarmTopic(ROOT, ident, 'A2'), msg(alarm), true).violations).toContain('alarmId disagrees with the topic');
    expect(inspectMessage(ROOT, alarmTopic(ROOT, ident, 'A1'), msg(alarm), false).violations).toContain('active alarm not retained');
    expect(inspectMessage(ROOT, alarmTopic(ROOT, ident, 'A1'), '', true).violations).toEqual([]);
  });

  it('validates replies and refuses retained ones', () => {
    const topic = machineTopic(ROOT, ident, CHANNEL.REPLY);
    expect(inspectMessage(ROOT, topic, msg({ cmdId: 'c1', status: 'accepted', reason: 'ok' }), false).violations).toEqual([]);
    expect(inspectMessage(ROOT, topic, msg({ cmdId: 'c1', status: 'maybe', reason: 'ok' })).violations.length).toBeGreaterThan(0);
    expect(inspectMessage(ROOT, topic, msg({ cmdId: 'c1', status: 'accepted', reason: 'ok' }), true).violations).toContain('reply must not be retained');
  });
});
