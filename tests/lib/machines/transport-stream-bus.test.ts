import { describe, it, expect, vi, afterEach } from 'vitest';

import { MemoryMessagingProvider } from '../../../lib/messaging';
import { DISPOSITION, StreamMachineBus, type InboundMessage } from '../../../lib/machines/transport';
import { genericCodec } from '../../../lib/machines/protocol';
import { until } from '../../../services/machines/testing/wait';

vi.mock('../../../lib/machines/transport/mqtt-session', () => ({
  MqttSession: { open: async () => ({ publish: async () => undefined, retained: async () => [], close: async () => undefined }) },
}));

const mqtt = { url: 'mqtt://site' };
const line = genericCodec({ root: 'line/v1' });
const other = { root: 'acme/v2', channels: { events: ['events'], telemetry: ['telemetry'], commands: ['commands'] } };

async function provider() {
  const p = new MemoryMessagingProvider();
  await p.connect();
  return p;
}

function bus(p: MemoryMessagingProvider, lineId: string, codec: typeof other, siteCodecs: (typeof other)[]) {
  return new StreamMachineBus({ streams: p.streams, pubsub: p.pubsub, mqtt, controllerId: `gw-${lineId}`, siteId: 's', lineId, codec, siteCodecs, nakDelayMs: 10 });
}

const buses: StreamMachineBus[] = [];
afterEach(async () => { for (const b of buses.splice(0)) await b.close(); });

describe('two lines on one site, on different roots', () => {
  it.each([['line first', false], ['other first', true]])('both read their own events after starting %s', async (_name, reversed) => {
    const p = await provider();
    const a = bus(p, 'l1', line, [line, other]);
    const b = bus(p, 'l2', other, [line, other]);
    buses.push(a, b);
    for (const x of reversed ? [b, a] : [a, b]) await x.connect();
    const seen: Record<string, string[]> = { l1: [], l2: [] };
    const read = (key: string) => async (m: InboundMessage) => { seen[key].push(m.topic); return DISPOSITION.ACK; };
    await a.consume(read('l1'));
    await b.consume(read('l2'));
    await p.streams.append('line.v1.s.l1.m1.job', '{}');
    await p.streams.append('acme.v2.s.l2.m2.events', '{}');
    await until(() => seen.l1.length === 1 && seen.l2.length === 1);
    expect(seen).toEqual({ l1: ['line/v1/s/l1/m1/job'], l2: ['acme/v2/s/l2/m2/events'] });
    expect((await p.streams.describeStream('LINE_EVENTS'))?.subjects).toEqual(expect.arrayContaining(['line.v1.*.*.*.job', 'acme.v2.*.*.*.events']));
  });

  it('refuses to start a consumer the stream would feed nothing', async () => {
    const p = await provider();
    const first = bus(p, 'l1', line, []);
    buses.push(first);
    await first.connect();
    const streams = { ...p.streams, ensureStream: async () => undefined, describeStream: p.streams.describeStream.bind(p.streams), ensureConsumer: p.streams.ensureConsumer.bind(p.streams) };
    const second = new StreamMachineBus({ streams: streams as typeof p.streams, pubsub: p.pubsub, mqtt, controllerId: 'gw-l2', siteId: 's', lineId: 'l2', codec: other });
    await expect(second.connect()).rejects.toThrow(/LINE_EVENTS keeps nothing of acme\.v2\.s\.l2\.\*\.events/);
  });
});
