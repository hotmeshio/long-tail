import { describe, it, expect } from 'vitest';

import {
  alarmTopic, assertTopicLevel, buildEnvelope, clientIdOf, isoTs, lineFilter, machineTopic, parsePayload, parseTopic,
  toSubject, toTopic,
} from '../../../examples/workflows/machine-line/protocol';
import { toEscalationEvent, topicMatches } from '../../../examples/workflows/machine-line/transport';

const ROOT = 'line/v1';
const ident = { siteId: 'site-1', lineId: 'line-1', machineId: 'press-01' };

describe('envelope', () => {
  it('builds the envelope with a uuid, a millisecond UTC time and the source', () => {
    const env = buildEnvelope(ident, { online: true });
    expect(env).toMatchObject({ v: '1', source: { site: 'site-1', line: 'line-1', machine: 'press-01' }, body: { online: true } });
    expect(env.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(env.at).toMatch(/\.\d{3}Z$/);
    expect(isoTs(0)).toBe('1970-01-01T00:00:00.000Z');
  });

  it('derives the client id and parses only JSON objects', () => {
    expect(clientIdOf(ident)).toBe('site-1-line-1-press-01');
    expect(parsePayload('{"a":1}')).toEqual({ a: 1 });
    expect(parsePayload('')).toBeNull();
    expect(parsePayload('[1]')).toBeNull();
    expect(parsePayload('nope')).toBeNull();
  });
});

describe('topics', () => {
  it('builds and classifies every channel', () => {
    expect(parseTopic(ROOT, machineTopic(ROOT, ident, 'presence'))?.kind).toBe('presence');
    expect(parseTopic(ROOT, machineTopic(ROOT, ident, 'snapshot'))?.kind).toBe('snapshot');
    expect(parseTopic(ROOT, machineTopic(ROOT, ident, 'job'))?.kind).toBe('job');
    expect(parseTopic(ROOT, machineTopic(ROOT, ident, 'cmd'))?.kind).toBe('cmd');
    expect(parseTopic(ROOT, machineTopic(ROOT, ident, 'cmd/reply'))?.kind).toBe('reply');
    expect(parseTopic(ROOT, alarmTopic(ROOT, ident, 'A1'))).toMatchObject({ kind: 'alarm', key: 'A1' });
    expect(parseTopic(ROOT, 'other/v1/a/b/c/presence')).toBeNull();
    expect(parseTopic(ROOT, `${ROOT}/a/b/c/unknown`)).toBeNull();
  });

  it('maps topics to NATS subjects and back', () => {
    const topic = machineTopic(ROOT, ident, 'cmd/reply');
    expect(toSubject(topic)).toBe('line.v1.site-1.line-1.press-01.cmd.reply');
    expect(toTopic(toSubject(topic))).toBe(topic);
    expect(lineFilter(ROOT, 'site-1', 'line-1')).toBe('line/v1/site-1/line-1/#');
  });

  it('rejects levels that would not survive the subject mapping', () => {
    expect(() => assertTopicLevel('machineId', 'press.01')).toThrow();
    expect(() => assertTopicLevel('machineId', 'press/01')).toThrow();
    expect(() => assertTopicLevel('machineId', '')).toThrow();
    expect(() => assertTopicLevel('machineId', 'press-01')).not.toThrow();
  });

  it('matches MQTT filters', () => {
    expect(topicMatches('a/+/c', 'a/b/c')).toBe(true);
    expect(topicMatches('a/#', 'a/b/c')).toBe(true);
    expect(topicMatches('a/+', 'a/b/c')).toBe(false);
    expect(topicMatches('a/b', 'a/b')).toBe(true);
  });
});

describe('escalation events', () => {
  it('reads an LTEvent body with or without the subject prefix', () => {
    const body = { type: 'system.escalation.line-trim.e1.created', escalationId: 'e1', role: 'line-trim', data: { id: 'e1' } };
    expect(toEscalationEvent(body)).toMatchObject({ verb: 'created', escalationId: 'e1', role: 'line-trim' });
    expect(toEscalationEvent({ type: 'lt.events.system.escalation.r.e2.resolved' })).toMatchObject({ verb: 'resolved', escalationId: 'e2' });
    expect(toEscalationEvent({ type: 'system.workflow.w1.completed' })).toBeNull();
  });
});
