import { describe, expect, it } from 'vitest';
import { NatsEventAdapter } from '../../../lib/events/nats';
import { MemoryMessagingProvider } from '../../../lib/messaging';
import type { LTEvent, LTEventAdapter } from '../../../types';

function recorder(): LTEventAdapter & { got: LTEvent[] } {
  const got: LTEvent[] = [];
  return { got, connect: async () => {}, disconnect: async () => {}, publish: async (e) => { got.push(e); } };
}

describe('NATS event adapter on Long Tail messaging', () => {
  it('publishes over the shared pub/sub and bridges other containers\' events to the local callback adapter', async () => {
    const { pubsub } = new MemoryMessagingProvider();
    const here = new NatsEventAdapter({ pubsub, wsUrl: 'ws://h:9222' });
    const there = new NatsEventAdapter({ pubsub });
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
});
