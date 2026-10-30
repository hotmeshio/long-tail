import { describe, expect, it } from 'vitest';
import { DELIVERY, MemoryMessagingProvider, START_AT } from '../../../lib/messaging';
import type { Delivery, LTStreamMessage } from '../../../types/messaging';
import { sleep, until } from '../../../services/machines/testing/wait';

const STREAM = { name: 'EVENTS', subjects: ['line.>'], maxAgeMs: 60_000 };

async function streamWith(startAt = START_AT.NEW as 'new' | 'all') {
  const provider = new MemoryMessagingProvider();
  await provider.connect();
  const streams = provider.streams;
  await streams.ensureStream(STREAM);
  await streams.ensureConsumer('EVENTS', { name: 'gw', filterSubjects: ['line.a.>'], startAt });
  return { provider, streams };
}

/** Consume, recording each delivery; `decide` picks the outcome. */
async function record(streams: MemoryMessagingProvider['streams'], decide: (m: LTStreamMessage) => Delivery, nakDelayMs = 20) {
  const seen: LTStreamMessage[] = [];
  const sub = await streams.consume('EVENTS', 'gw', async (m) => { seen.push(m); return decide(m); }, { nakDelayMs });
  return { seen, sub };
}

describe('memory messaging: pub/sub', () => {
  it('fans a publish out to every subscriber whose filter matches', async () => {
    const { pubsub } = new MemoryMessagingProvider();
    const got: string[] = [];
    pubsub.subscribe('lt.events.>', (m) => got.push(`all:${m.subject}`));
    const one = pubsub.subscribe('lt.events.*.created', (m) => got.push(`created:${m.payload}`));
    await pubsub.publish('lt.events.row.created', 'r1');
    await pubsub.publish('lt.other', 'x');
    await one.close();
    await pubsub.publish('lt.events.row.created', 'r2');
    expect(got).toEqual(['all:lt.events.row.created', 'created:r1', 'all:lt.events.row.created']);
  });
});

describe('memory messaging: streams', () => {
  it('delivers in order, only the subjects the consumer reads, from where it started', async () => {
    const { streams } = await streamWith();
    await streams.append('line.a.m1.job', 'before');
    await streams.ensureConsumer('EVENTS', { name: 'late', filterSubjects: ['line.a.>'] });
    const { seen } = await record(streams, () => DELIVERY.ACK);
    await streams.append('line.a.m1.job', 'one');
    await streams.append('line.b.m1.job', 'other line');
    await streams.append('line.a.m2.job', 'two');
    await until(() => seen.length === 3);
    expect(seen.map((m) => m.payload)).toEqual(['before', 'one', 'two']);
    expect(seen.every((m) => m.deliveries === 1)).toBe(true);
  });

  it('starts a consumer at the whole history when asked', async () => {
    const provider = new MemoryMessagingProvider();
    await provider.streams.ensureStream(STREAM);
    await provider.streams.append('line.a.m1.job', 'old');
    await provider.streams.ensureConsumer('EVENTS', { name: 'gw', filterSubjects: ['line.>'], startAt: START_AT.ALL });
    const { seen } = await record(provider.streams, () => DELIVERY.ACK);
    await until(() => seen.length === 1);
    expect(seen[0].payload).toBe('old');
  });

  it('delivers a nak\'d message again after its delay while later messages go on', async () => {
    const { streams } = await streamWith();
    const { seen } = await record(streams, (m) => (m.payload === 'wait' && m.deliveries < 3 ? DELIVERY.NAK : DELIVERY.ACK));
    await streams.append('line.a.m1.job', 'wait');
    await streams.append('line.a.m1.job', 'next');
    await until(() => seen.filter((m) => m.payload === 'wait').length === 3);
    expect(seen.map((m) => `${m.payload}#${m.deliveries}`)).toEqual(['wait#1', 'next#1', 'wait#2', 'wait#3']);
  });

  it('drops a term\'d message and takes a thrown handler as a nak', async () => {
    const { streams } = await streamWith();
    let thrown = false;
    const seen: string[] = [];
    await streams.consume('EVENTS', 'gw', async (m) => {
      seen.push(`${m.payload}#${m.deliveries}`);
      if (m.payload === 'boom' && !thrown) { thrown = true; throw new Error('handler failed'); }
      return m.payload === 'drop' ? DELIVERY.TERM : DELIVERY.ACK;
    }, { nakDelayMs: 10 });
    await streams.append('line.a.m1.job', 'drop');
    await streams.append('line.a.m1.job', 'boom');
    await until(() => seen.includes('boom#2'));
    await sleep(30);
    expect(seen).toEqual(['drop#1', 'boom#1', 'boom#2']);
  });

  it('keeps a consumer\'s position across consumes and a re-ensure', async () => {
    const { streams } = await streamWith();
    const first = await record(streams, () => DELIVERY.ACK);
    await streams.append('line.a.m1.job', 'one');
    await until(() => first.seen.length === 1);
    await first.sub.close();
    await streams.append('line.a.m1.job', 'two');
    await streams.ensureConsumer('EVENTS', { name: 'gw', filterSubjects: ['line.a.>'] });
    const second = await record(streams, () => DELIVERY.ACK);
    await until(() => second.seen.length === 1);
    expect(second.seen[0].payload).toBe('two');
  });

  it('refuses a consumer that was never ensured', async () => {
    const { streams } = await streamWith();
    await expect(streams.consume('EVENTS', 'nobody', async () => DELIVERY.ACK)).rejects.toThrow(/no consumer nobody/);
    await expect(streams.consume('NOPE', 'gw', async () => DELIVERY.ACK)).rejects.toThrow(/no stream NOPE/);
  });
});
