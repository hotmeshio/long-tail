import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DELIVERY } from '../../lib/messaging';
import { NatsMessagingProvider } from '../../lib/messaging/nats/provider';
import { sleep, until } from '../../services/machines/testing/wait';

// A NATS server with JetStream, e.g. `docker run -p 14222:4222 nats:2.14-alpine -js`.
const URL = process.env.LT_NATS_TEST_URL;
const RUN = `t${Date.now().toString(36)}`;

describe.skipIf(!URL)('NATS messaging provider (live server)', () => {
  const provider = new NatsMessagingProvider({ url: URL!, name: `lt-test-${RUN}` });
  const stream = `TEST_${RUN.toUpperCase()}`;

  beforeAll(async () => {
    await provider.connect();
    await provider.streams!.ensureStream({ name: stream, subjects: [`${RUN}.>`], maxAgeMs: 60_000 });
  });

  afterAll(async () => {
    await provider.disconnect();
  });

  it('connects with JetStream and fans out pub/sub', async () => {
    expect(provider.connected).toBe(true);
    expect(provider.streams).not.toBeNull();
    const got: string[] = [];
    const sub = provider.pubsub.subscribe(`${RUN}.ps.*`, (m) => got.push(m.payload));
    await provider.pubsub.publish(`${RUN}.ps.a`, 'hello');
    await until(() => got.length === 1);
    await sub.close();
    expect(got).toEqual(['hello']);
  });

  it('keeps appended messages and delivers them to a durable consumer with nak, redelivery and term', async () => {
    const streams = provider.streams!;
    await streams.ensureConsumer(stream, { name: 'gw', filterSubjects: [`${RUN}.line.>`], startAt: 'new' });
    const seen: string[] = [];
    const sub = await streams.consume(stream, 'gw', async (m) => {
      seen.push(`${m.payload}#${m.deliveries}`);
      if (m.payload === 'later' && m.deliveries < 2) return DELIVERY.NAK;
      return m.payload === 'drop' ? DELIVERY.TERM : DELIVERY.ACK;
    }, { nakDelayMs: 200 });
    await streams.append(`${RUN}.line.m1.job`, 'later');
    await streams.append(`${RUN}.line.m1.job`, 'drop');
    await streams.append(`${RUN}.other.m1.job`, 'not mine');
    await until(() => seen.includes('later#2'), 5_000);
    await sleep(300);
    await sub.close();
    expect(seen).toEqual(['later#1', 'drop#1', 'later#2']);
  });

  it('keeps the consumer\'s position across a re-ensure', async () => {
    const streams = provider.streams!;
    await streams.append(`${RUN}.line.m1.job`, 'after');
    await streams.ensureConsumer(stream, { name: 'gw', filterSubjects: [`${RUN}.line.>`] });
    const seen: string[] = [];
    const sub = await streams.consume(stream, 'gw', async (m) => { seen.push(m.payload); return DELIVERY.ACK; });
    await until(() => seen.length === 1, 5_000);
    await sleep(200);
    await sub.close();
    expect(seen).toEqual(['after']);
  });
});

describe.skipIf(!process.env.LT_NATS_TEST_URL_NO_JS)('NATS messaging provider without JetStream', () => {
  it('serves pub/sub and reports no streams', async () => {
    const provider = new NatsMessagingProvider({ url: process.env.LT_NATS_TEST_URL_NO_JS! });
    await provider.connect();
    expect(provider.streams).toBeNull();
    await provider.disconnect();
  });
});
