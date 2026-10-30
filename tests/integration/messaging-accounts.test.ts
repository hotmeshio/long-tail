import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type NatsConnection } from 'nats';
import mqtt, { type MqttClient } from 'mqtt';
import { DELIVERY } from '../../lib/messaging';
import { NatsMessagingProvider } from '../../lib/messaging/nats/provider';
import { sleep, until } from '../../services/machines/testing/wait';
import { ACCOUNTS } from '../helpers/nats-accounts-conf';

// A server running tests/helpers/nats-accounts-conf.ts, e.g.
//   npx ts-node -T tests/helpers/nats-accounts-conf.ts > nats.conf
//   docker run -v $PWD/nats.conf:/etc/nats/nats.conf -p 14324:4222 -p 14883:1883 nats:2.14-alpine -c /etc/nats/nats.conf
const URL = process.env.LT_NATS_ACCOUNTS_URL;
const MQTT_URL = process.env.LT_NATS_ACCOUNTS_MQTT;

function bridge(): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const c = mqtt.connect(MQTT_URL!, { username: ACCOUNTS.bridge.user, password: ACCOUNTS.bridge.password, clientId: `bridge-${Date.now()}`, protocolVersion: 4 });
    c.once('connect', () => resolve(c));
    c.once('error', reject);
  });
}

describe.skipIf(!URL || !MQTT_URL)('Long Tail NATS accounts (live server)', () => {
  const server = new NatsMessagingProvider({ url: URL!, user: ACCOUNTS.server.user, password: ACCOUNTS.server.password });
  let edge: MqttClient;

  beforeAll(async () => {
    await server.connect();
    await server.streams!.ensureStream({ name: ACCOUNTS.stream, subjects: ['line.v1.*.*.*.job'], maxAgeMs: 60_000 });
    await server.streams!.ensureConsumer(ACCOUNTS.stream, { name: ACCOUNTS.gateway.durable, filterSubjects: ['line.v1.site-1.line-1.*.job'] });
    edge = await bridge();
  });

  afterAll(async () => {
    edge?.end(true);
    await server.disconnect();
  });

  it('keeps what the edge bridge publishes for its line in Long Tail\'s stream, read through the gateway\'s own login', async () => {
    edge.publish('line/v1/site-1/line-1/press-01/job', '{"event":"arrived"}', { qos: 1 });
    const gateway = new NatsMessagingProvider({ url: URL!, user: ACCOUNTS.gateway.user, password: ACCOUNTS.gateway.password });
    await gateway.connect();
    const seen: string[] = [];
    const sub = await gateway.streams!.consume(ACCOUNTS.stream, ACCOUNTS.gateway.durable, async (m) => { seen.push(m.subject); return DELIVERY.ACK; });
    await until(() => seen.length > 0, 5_000);
    await sub.close();
    await gateway.disconnect();
    expect(seen).toEqual(['line.v1.site-1.line-1.press-01.job']);
  });

  it('gives the edge no way into Long Tail\'s subjects or another line\'s', async () => {
    const heard: string[] = [];
    const sub = server.pubsub.subscribe('>', (m) => { if (!m.subject.startsWith('$') && !m.subject.startsWith('_INBOX')) heard.push(m.subject); });
    edge.publish('lt/events/system/escalation/r/1/created', '{}', { qos: 1 });
    edge.publish('line/v1/site-2/line-9/x/job', '{}', { qos: 1 });
    await sleep(500);
    await sub.close();
    expect(heard.filter((s) => s.startsWith('lt.') || s.includes('site-2'))).toEqual([]);
  });

  it('keeps the dashboard to subscribing, and the gateway from deleting a stream', async () => {
    const dashboard: NatsConnection = await connect({ servers: URL!, user: ACCOUNTS.dashboard.user, pass: ACCOUNTS.dashboard.password });
    const heard: string[] = [];
    const sub = server.pubsub.subscribe('lt.events.>', (m) => heard.push(m.subject));
    dashboard.publish('lt.events.system.escalation.r.1.created', '{}');
    await sleep(300);
    await sub.close();
    expect(heard).toEqual([]);
    await dashboard.close();

    const gw = await connect({ servers: URL!, user: ACCOUNTS.gateway.user, pass: ACCOUNTS.gateway.password });
    const jsm = await gw.jetstreamManager({ timeout: 2_000 }).catch(() => null);
    const deleted = jsm ? await jsm.streams.delete(ACCOUNTS.stream).then(() => true).catch(() => false) : false;
    await gw.close();
    expect(deleted).toBe(false);
    expect(await server.streams!.ensureStream({ name: ACCOUNTS.stream, subjects: ['line.v1.*.*.*.job'], maxAgeMs: 60_000 }).then(() => true)).toBe(true);
  });
});
