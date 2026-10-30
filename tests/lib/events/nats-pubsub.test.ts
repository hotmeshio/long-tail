import { describe, expect, it, vi } from 'vitest';
import { NatsEventAdapter } from '../../../lib/events/nats';
import { MemoryMessagingProvider } from '../../../lib/messaging';
import type { LTEvent, LTEventAdapter } from '../../../types';

function recorder(): LTEventAdapter & { got: LTEvent[] } {
  const got: LTEvent[] = [];
  return { got, connect: async () => {}, disconnect: async () => {}, publish: async (e) => { got.push(e); } };
}

describe('NATS event adapter on Long Tail messaging', () => {
  it('publishes over the shared pub/sub and bridges other containers\' events to the local callback adapter', async () => {
    const messaging = new MemoryMessagingProvider();
    await messaging.connect();
    const here = new NatsEventAdapter({ messaging, wsUrl: 'ws://h:9222' });
    const there = new NatsEventAdapter({ messaging });
    const local = recorder();
    here.setCallbackBridge(local);
    await here.connect();
    await there.connect();

    await there.publish({ type: 'system.escalation.r.1.created', timestamp: 't' } as LTEvent);
    await here.publish({ type: 'system.workflow.w.completed', timestamp: 't' } as LTEvent);
    expect(local.got.map((e) => e.type)).toEqual(['system.escalation.r.1.created']);
    expect(here.wsUrl).toBe('ws://h:9222');

    await here.disconnect();
    await there.publish({ type: 'system.escalation.r.2.created', timestamp: 't' } as LTEvent);
    expect(local.got).toHaveLength(1);
  });

  it('skips publishing while the messaging connection is down', async () => {
    const messaging = new MemoryMessagingProvider();
    const publish = vi.spyOn(messaging.pubsub, 'publish');
    const adapter = new NatsEventAdapter({ messaging });

    await expect(adapter.publish({ type: 'system.workflow.w.completed', timestamp: 't' } as LTEvent)).resolves.toBeUndefined();
    expect(publish).not.toHaveBeenCalled();

    await messaging.connect();
    await adapter.publish({ type: 'system.workflow.w.completed', timestamp: 't' } as LTEvent);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
