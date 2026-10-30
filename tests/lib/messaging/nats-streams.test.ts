import { describe, expect, it } from 'vitest';
import { consumerConfig, ensureConsumer, ensureStream, streamConfig } from '../../../lib/messaging/nats/streams';
import { lineEventConsumerSpec, lineStreamSpecs, LINE_STREAM } from '../../../lib/machines/transport';

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
      info: async (_s: string, name: string) => {
        if (!consumers.includes(name)) throw notFound('consumer');
        return { config: { filter_subjects: ['line.v1.s.l.*.job'] } };
      },
      add: async (s: string, c: any) => { calls.push(`consumer ${s}/${c.durable_name}`); },
      update: async (s: string, name: string, c: any) => { calls.push(`update ${s}/${name} ${c.filter_subjects.length}`); },
    },
  } as any;
}

describe('JetStream from messaging specs', () => {
  it('maps a stream spec to a file-backed stream kept for its age', () => {
    const [events] = lineStreamSpecs('line/v1');
    expect(streamConfig(events)).toMatchObject({ name: LINE_STREAM.EVENTS, subjects: events.subjects, storage: 'file', max_age: events.maxAgeMs * 1_000_000 });
  });

  it('maps a consumer spec to an explicit-ack durable starting where asked', () => {
    const spec = lineEventConsumerSpec('line/v1', 's', 'l', 'gw');
    expect(consumerConfig(spec)).toMatchObject({ durable_name: 'gw', ack_policy: 'explicit', deliver_policy: 'new', ack_wait: 30_000 * 1_000_000 });
    expect(consumerConfig({ ...spec, startAt: 'all' }).deliver_policy).toBe('all');
  });

  it('adds a missing stream and updates an existing one', async () => {
    const jsm = fakeJsm([LINE_STREAM.EVENTS]);
    for (const spec of lineStreamSpecs('line/v1')) await ensureStream(jsm, spec);
    expect(jsm.calls).toEqual([`update ${LINE_STREAM.EVENTS}`, `add ${LINE_STREAM.TELEMETRY}`]);
  });

  it('rethrows anything other than not found', async () => {
    await expect(ensureStream(fakeJsm([], [], new Error('authorization violation')), lineStreamSpecs('line/v1')[0])).rejects.toThrow(/authorization/);
  });

  it('creates a missing consumer, and moves an existing one to new subjects without losing its place', async () => {
    const jsm = fakeJsm([], ['gw']);
    await ensureConsumer(jsm, LINE_STREAM.EVENTS, lineEventConsumerSpec('line/v1', 's', 'l', 'gw'));
    await ensureConsumer(jsm, LINE_STREAM.EVENTS, lineEventConsumerSpec('line/v1', 's', 'l', 'other'));
    expect(jsm.calls).toEqual([`update ${LINE_STREAM.EVENTS}/gw 6`, `consumer ${LINE_STREAM.EVENTS}/other`]);
  });

  it('leaves a consumer alone when its subjects already match', async () => {
    const jsm = fakeJsm([], ['gw']);
    await ensureConsumer(jsm, LINE_STREAM.EVENTS, { name: 'gw', filterSubjects: ['line.v1.s.l.*.job'] });
    expect(jsm.calls).toEqual([]);
  });
});
