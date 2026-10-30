import { describe, it, expect } from 'vitest';

import {
  LINE_STREAM, lineEventConsumerSpec, lineStreamSpecs, telemetrySubjects, filterToSubject,
} from '../../../lib/machines/transport';

describe('site streams', () => {
  it('splits machine events and telemetry into two streams', () => {
    const streams = lineStreamSpecs('line/v1');
    expect(streams).toHaveLength(2);
    const [events, telemetry] = streams;
    expect(events.name).toBe(LINE_STREAM.EVENTS);
    expect(events.subjects).toEqual([
      'line.v1.*.*.*.presence', 'line.v1.*.*.*.snapshot', 'line.v1.*.*.*.job', 'line.v1.*.*.*.alarm.*', 'line.v1.*.*.*.cmd.reply', 'line.v1.*.*.*.report.>',
    ]);
    expect(telemetry.subjects).toEqual(['line.v1.*.*.*.telemetry']);
    expect(events.subjects).not.toContain('line.v1.*.*.*.cmd');
  });

  it('reads one line through a durable consumer that starts at new messages', () => {
    const c = lineEventConsumerSpec('line/v1', 'site-1', 'line-1', 'gw');
    expect(c).toMatchObject({ name: 'gw', startAt: 'new', ackWaitMs: 30_000 });
    expect(c.filterSubjects).toContain('line.v1.site-1.line-1.*.job');
    expect(lineStreamSpecs('line/v1').map((x) => x.maxAgeMs)).toEqual([30 * 86_400_000, 3 * 86_400_000]);
    expect(telemetrySubjects('line/v1', 'site-1', 'line-1')).toEqual(['line.v1.site-1.line-1.*.telemetry']);
  });
});

describe('channels from a codec', () => {
  it('maps MQTT filters to NATS subjects', () => {
    expect(filterToSubject('a/+/b/#')).toBe('a.*.b.>');
  });

  it('builds the streams and the consumer from the codec\'s own channels', () => {
    const channels = { events: ['state', 'work', 'events/alert/+'], telemetry: ['readings/raw'], commands: ['control'] };
    const [events, telemetry] = lineStreamSpecs({ root: 'acme/v1', channels });
    expect(events.subjects).toEqual(['acme.v1.*.*.*.state', 'acme.v1.*.*.*.work', 'acme.v1.*.*.*.events.alert.*']);
    expect(telemetry.subjects).toEqual(['acme.v1.*.*.*.readings.raw']);
    expect(lineEventConsumerSpec({ root: 'acme/v1', channels }, 's', 'l', 'gw').filterSubjects).toContain('acme.v1.s.l.*.work');
  });

  it('follows a codec\'s own topic layout, such as a direction level before the machine', () => {
    const codec = {
      root: 'acme/v1',
      channels: { events: ['events'], telemetry: ['telemetry'], commands: ['commands'] },
      topicFor: (s: { siteId?: string; lineId?: string; address?: string }, c: string) =>
        `acme/v1/${s.siteId ?? '+'}/${s.lineId ?? '+'}/${c === 'commands' ? 'down' : 'up'}/${s.address ?? '+'}/${c}`,
    };
    const [events, telemetry] = lineStreamSpecs(codec);
    expect(events.subjects).toEqual(['acme.v1.*.*.up.*.events']);
    expect(telemetry.subjects).toEqual(['acme.v1.*.*.up.*.telemetry']);
    expect(lineEventConsumerSpec(codec, 's', 'l', 'gw').filterSubjects).toEqual(['acme.v1.s.l.up.*.events']);
    expect(telemetrySubjects(codec, 's', 'l')).toEqual(['acme.v1.s.l.up.*.telemetry']);
  });
});
