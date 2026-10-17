import { describe, it, expect } from 'vitest';

import {
  LINE_STREAM, LT_ESCALATION_SUBJECTS, ensureConsumer, ensureStreams, lineEventConsumer, lineStreamConfigs, telemetrySubjects, filterToSubject,
} from '../../../lib/machines/transport';

describe('site streams', () => {
  it('splits machine events, telemetry and Long Tail escalation events into three streams', () => {
    const [events, telemetry, lt] = lineStreamConfigs('line/v1');
    expect(events.name).toBe(LINE_STREAM.EVENTS);
    expect(events.subjects).toEqual([
      'line.v1.*.*.*.presence', 'line.v1.*.*.*.snapshot', 'line.v1.*.*.*.job', 'line.v1.*.*.*.alarm.*', 'line.v1.*.*.*.cmd.reply',
    ]);
    expect(telemetry.subjects).toEqual(['line.v1.*.*.*.telemetry']);
    expect(lt).toMatchObject({ name: LINE_STREAM.LT_EVENTS, subjects: [LT_ESCALATION_SUBJECTS] });
    expect(events.subjects).not.toContain('line.v1.*.*.*.cmd');
  });

  it('reads one line through a durable consumer that starts at new messages', () => {
    const c = lineEventConsumer('line/v1', 'site-1', 'line-1', 'gw');
    expect(c).toMatchObject({ durable_name: 'gw', ack_policy: 'explicit', deliver_policy: 'new' });
    expect(c.filter_subjects).toContain('line.v1.site-1.line-1.*.job');
    expect(telemetrySubjects('line/v1', 'site-1', 'line-1')).toEqual(['line.v1.site-1.line-1.*.telemetry']);
  });
});

function fakeJsm(existing: string[] = [], consumers: string[] = [], failWith?: Error) {
  const calls: string[] = [];
  const notFound = (what: string) => Object.assign(new Error(`${what} not found`), { code: '404' });
  return {
    calls,
    streams: {
      info: async (name: string) => { if (failWith) throw failWith; if (!existing.includes(name)) throw notFound('stream'); return {}; },
      add: async (c: any) => { calls.push(`add ${c.name}`); },
      update: async (name: string) => { calls.push(`update ${name}`); },
    },
    consumers: {
      info: async (_s: string, name: string) => { if (!consumers.includes(name)) throw notFound('consumer'); return {}; },
      add: async (s: string, c: any) => { calls.push(`consumer ${s}/${c.durable_name}`); },
    },
  } as any;
}

describe('channels from a codec', () => {
  it('maps MQTT filters to NATS subjects', () => {
    expect(filterToSubject('a/+/b/#')).toBe('a.*.b.>');
  });

  it('builds the streams and the consumer from the codec\'s own channels', () => {
    const channels = { events: ['state', 'work', 'events/alert/+'], telemetry: ['readings/raw'] };
    const [events, telemetry] = lineStreamConfigs('acme/v1', channels);
    expect(events.subjects).toEqual(['acme.v1.*.*.*.state', 'acme.v1.*.*.*.work', 'acme.v1.*.*.*.events.alert.*']);
    expect(telemetry.subjects).toEqual(['acme.v1.*.*.*.readings.raw']);
    expect(lineEventConsumer('acme/v1', 's', 'l', 'gw', channels).filter_subjects).toContain('acme.v1.s.l.*.work');
  });
});

describe('ensuring streams and consumers', () => {
  it('adds missing streams and updates existing ones', async () => {
    const jsm = fakeJsm([LINE_STREAM.EVENTS]);
    await ensureStreams(jsm, lineStreamConfigs('line/v1'));
    expect(jsm.calls).toEqual([`update ${LINE_STREAM.EVENTS}`, `add ${LINE_STREAM.TELEMETRY}`, `add ${LINE_STREAM.LT_EVENTS}`]);
  });

  it('rethrows anything other than not found', async () => {
    await expect(ensureStreams(fakeJsm([], [], new Error('authorization violation')), lineStreamConfigs('line/v1'))).rejects.toThrow(/authorization/);
  });

  it('creates a consumer once and leaves an existing one where it is', async () => {
    const jsm = fakeJsm([], ['gw']);
    await ensureConsumer(jsm, LINE_STREAM.EVENTS, lineEventConsumer('line/v1', 's', 'l', 'gw'));
    await ensureConsumer(jsm, LINE_STREAM.EVENTS, lineEventConsumer('line/v1', 's', 'l', 'other'));
    expect(jsm.calls).toEqual([`consumer ${LINE_STREAM.EVENTS}/other`]);
  });
});
