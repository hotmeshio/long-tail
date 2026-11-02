import { describe, expect, it } from 'vitest';
import { consumerConfig, describeConsumer, describeStream, ensureConsumer, ensureStream, streamConfig } from '../../../lib/messaging/nats/streams';
import { lineEventConsumerSpec, lineStreamSpecs, LINE_STREAM } from '../../../lib/machines/transport';

function fakeJsm(existing: string[] = [], consumers: string[] = [], failWith?: Error, opts: { raced?: boolean } = {}) {
  const calls: string[] = [];
  const notFound = (what: string) => Object.assign(new Error(`${what} not found`), { code: '404' });
  return {
    calls,
    streams: {
      info: async (name: string) => {
        if (failWith) throw failWith;
        if (!existing.includes(name)) throw notFound('stream');
        return { config: { subjects: ['line.v1.>'], max_age: 60_000 * 1_000_000 } };
      },
      add: async (c: any) => {
        calls.push(`add ${c.name}`);
        // Another line created the stream between this line's look and its create.
        if (opts.raced) throw new Error('stream name already in use with a different configuration');
      },
      update: async (name: string) => { calls.push(`update ${name}`); },
    },
    consumers: {
      info: async (_s: string, name: string) => {
        if (!consumers.includes(name)) throw notFound('consumer');
        return { config: { filter_subjects: ['line.v1.s.l.*.job'] } };
      },
      add: async (s: string, c: any) => { calls.push(`consumer ${s}/${c.durable_name}`); },
      update: async (s: string, name: string, c: any) => { calls.push(`update ${s}/${name} ${c.filter_subjects.length}`); },
      delete: async (s: string, name: string) => { calls.push(`delete ${s}/${name}`); return true; },
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

  it('describes a stream from its JetStream config, and a missing one as null', async () => {
    expect(await describeStream(fakeJsm([LINE_STREAM.EVENTS]), LINE_STREAM.EVENTS)).toEqual({ name: LINE_STREAM.EVENTS, subjects: ['line.v1.>'], maxAgeMs: 60_000 });
    expect(await describeStream(fakeJsm([]), LINE_STREAM.EVENTS)).toBeNull();
    await expect(describeStream(fakeJsm([], [], new Error('authorization violation')), LINE_STREAM.EVENTS)).rejects.toThrow(/authorization/);
  });

  it('updates a stream another line created between its look and its create', async () => {
    const jsm = fakeJsm([], [], undefined, { raced: true });
    await ensureStream(jsm, lineStreamSpecs('line/v1')[0]);
    expect(jsm.calls).toEqual([`add ${LINE_STREAM.EVENTS}`, `update ${LINE_STREAM.EVENTS}`]);
  });

  it('rethrows anything other than not found', async () => {
    await expect(ensureStream(fakeJsm([], [], new Error('authorization violation')), lineStreamSpecs('line/v1')[0])).rejects.toThrow(/authorization/);
  });

  it('creates a missing consumer, and makes an existing one again when its subjects changed', async () => {
    const jsm = fakeJsm([], ['gw']);
    await ensureConsumer(jsm, LINE_STREAM.EVENTS, lineEventConsumerSpec('line/v1', 's', 'l', 'gw'));
    await ensureConsumer(jsm, LINE_STREAM.EVENTS, lineEventConsumerSpec('line/v1', 's', 'l', 'other'));
    expect(jsm.calls).toEqual([`delete ${LINE_STREAM.EVENTS}/gw`, `consumer ${LINE_STREAM.EVENTS}/gw`, `consumer ${LINE_STREAM.EVENTS}/other`]);
  });

  it('describes a consumer by the subjects it reads, and a missing one as null', async () => {
    expect(await describeConsumer(fakeJsm([], ['gw']), LINE_STREAM.EVENTS, 'gw')).toEqual({ name: 'gw', filterSubjects: ['line.v1.s.l.*.job'] });
    expect(await describeConsumer(fakeJsm([], []), LINE_STREAM.EVENTS, 'gw')).toBeNull();
  });

  it('leaves a consumer alone when its subjects already match', async () => {
    const jsm = fakeJsm([], ['gw']);
    await ensureConsumer(jsm, LINE_STREAM.EVENTS, { name: 'gw', filterSubjects: ['line.v1.s.l.*.job'] });
    expect(jsm.calls).toEqual([]);
  });
});
