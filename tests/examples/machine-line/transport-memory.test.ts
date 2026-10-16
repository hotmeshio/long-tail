import { describe, it, expect } from 'vitest';

import { DISPOSITION, MemoryBroker, MemoryEscalationFeed, MemoryMachineBus, MemoryMachineLink, type InboundMessage } from '../../../examples/workflows/machine-line/transport';
import { sleep, until } from '../../helpers/machine-line-fixtures';

describe('memory broker: MQTT semantics', () => {
  it('delivers retained messages to new subscribers and clears them on an empty payload', async () => {
    const broker = new MemoryBroker();
    broker.publish('a/status', 'online', true);
    const got: InboundMessage[] = [];
    broker.connect('c1');
    broker.subscribe('c1', 'a/#', (m) => got.push(m));
    await sleep(1);
    expect(got.map((m) => m.payload)).toEqual(['online']);
    broker.publish('a/status', '', true);
    expect(broker.retained('a/#')).toEqual([]);
  });

  it('publishes the will on an ungraceful disconnect only', async () => {
    const broker = new MemoryBroker();
    const will = { topic: 'm/status', payload: 'offline', retain: true };
    broker.connect('m1', will);
    broker.disconnect('m1', true);
    expect(broker.retained('m/status')).toEqual([]);
    broker.connect('m1', will);
    broker.disconnect('m1', false);
    expect(broker.retained('m/status')[0].payload).toBe('offline');
  });

  it('queues QoS 1 messages for a persistent session while it is away', async () => {
    const broker = new MemoryBroker();
    const link = new MemoryMachineLink(broker);
    const got: string[] = [];
    await link.connect({ clientId: 'm1', will: { topic: 'm/status', payload: 'x', retain: true } });
    await link.subscribe('m/command', (msg) => got.push(msg.payload));
    await link.disconnect(false);
    expect(link.connected).toBe(false);
    broker.publish('m/command', 'cmd-while-away');
    await link.connect({ clientId: 'm1', will: { topic: 'm/status', payload: 'x', retain: true } });
    await until(() => got.length === 1);
    expect(got).toEqual(['cmd-while-away']);
  });
});

describe('memory bus: durable consumer', () => {
  it('redelivers a nak until it is acked', async () => {
    const broker = new MemoryBroker({ redeliverMs: 2 });
    const bus = new MemoryMachineBus(broker, 'line/#');
    const deliveries: number[] = [];
    await bus.consume(async (m) => {
      deliveries.push(m.deliveries);
      return m.deliveries < 3 ? DISPOSITION.NAK : DISPOSITION.ACK;
    });
    broker.publish('line/a', 'x');
    await until(() => deliveries.length === 3);
    await sleep(10);
    expect(deliveries).toEqual([1, 2, 3]);
  });

  it('replays what it missed after a restart, including unacked messages', async () => {
    const broker = new MemoryBroker({ redeliverMs: 50 });
    const first = new MemoryMachineBus(broker, 'line/#');
    const seen: string[] = [];
    await first.consume(async (m) => {
      seen.push(m.payload);
      return m.payload === 'one' ? DISPOSITION.ACK : DISPOSITION.NAK;
    });
    broker.publish('line/a', 'one');
    broker.publish('line/a', 'two');
    await until(() => seen.length === 2);
    await first.close();
    broker.publish('line/a', 'three');
    const second = new MemoryMachineBus(broker, 'line/#');
    const replay: string[] = [];
    await second.consume(async (m) => {
      replay.push(m.payload);
      return DISPOSITION.ACK;
    });
    await until(() => replay.length === 2);
    expect(replay).toEqual(['two', 'three']);
  });

  it('feeds escalation events and terms everything else', async () => {
    const broker = new MemoryBroker();
    const feed = new MemoryEscalationFeed(broker);
    const verbs: string[] = [];
    await feed.consume(async (e) => {
      verbs.push(`${e.role}:${e.verb}`);
      return DISPOSITION.ACK;
    });
    feed.emit({ type: 'system.workflow.w.completed' });
    feed.emit({ type: 'system.escalation.line-trim.e1.created', escalationId: 'e1', role: 'line-trim', data: {} });
    await until(() => verbs.length === 1);
    expect(verbs).toEqual(['line-trim:created']);
  });
});
