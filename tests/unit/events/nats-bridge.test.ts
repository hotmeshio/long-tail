import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/logger', () => ({
  loggerRegistry: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../modules/config', () => ({
  config: { NATS_URL: 'nats://localhost:4222' },
}));

// Mock nats module — simulate publish/subscribe
const mockMessages: Array<{ subject: string; data: Uint8Array }> = [];
const mockSubscriptions: Array<{
  pattern: string;
  handler: AsyncGenerator<{ subject: string; data: Uint8Array }>;
}> = [];

let subscribeIteratorResolve: ((value: { subject: string; data: Uint8Array }) => void) | null = null;

vi.mock('nats', () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return {
    connect: vi.fn().mockResolvedValue({
      publish: vi.fn((subject: string, data: Uint8Array) => {
        mockMessages.push({ subject, data });
      }),
      subscribe: vi.fn((pattern: string) => {
        const messages: Array<{ subject: string; data: Uint8Array }> = [];
        let resolve: ((value: IteratorResult<any>) => void) | null = null;

        const sub = {
          [Symbol.asyncIterator]() { return this; },
          next() {
            return new Promise<IteratorResult<any>>((r) => {
              subscribeIteratorResolve = (msg) => r({ value: msg, done: false });
            });
          },
          unsubscribe: vi.fn(),
        };
        return sub;
      }),
      drain: vi.fn(),
    }),
    StringCodec: () => ({
      encode: (s: string) => new TextEncoder().encode(s),
      decode: (b: Uint8Array) => new TextDecoder().decode(b),
    }),
  };
});

import { NatsEventAdapter } from '../../../lib/events/nats';
import { CallbackEventAdapter } from '../../../lib/events/callback';
import type { LTEvent } from '../../../types';

function makeEvent(overrides?: Partial<LTEvent>): LTEvent {
  return {
    type: 'workflow.completed',
    source: 'test',
    timestamp: new Date().toISOString(),
    workflowId: 'wf-1',
    workflowName: 'test',
    taskQueue: 'q',
    ...overrides,
  } as LTEvent;
}

beforeEach(() => {
  mockMessages.length = 0;
  subscribeIteratorResolve = null;
});

describe('NatsEventAdapter — cross-container bridge', () => {
  it('enriches published events with _originId', async () => {
    const adapter = new NatsEventAdapter({ url: 'nats://localhost:4222' });
    await adapter.connect();

    const event = makeEvent();
    await adapter.publish(event);

    expect(mockMessages).toHaveLength(1);
    const published = JSON.parse(new TextDecoder().decode(mockMessages[0].data));
    expect(published._originId).toBeDefined();
    expect(typeof published._originId).toBe('string');
    expect(published.type).toBe('workflow.completed');
  });

  it('publishes to correct NATS subject', async () => {
    const adapter = new NatsEventAdapter({ url: 'nats://localhost:4222' });
    await adapter.connect();

    await adapter.publish(makeEvent({ type: 'escalation.created' }));

    expect(mockMessages[0].subject).toBe('lt.events.escalation.created');
  });

  it('bridges received events to CallbackEventAdapter', async () => {
    const nats = new NatsEventAdapter({ url: 'nats://localhost:4222' });
    const callback = new CallbackEventAdapter();

    const received: LTEvent[] = [];
    callback.on('workflow.completed', (e) => received.push(e));

    nats.setCallbackBridge(callback);
    await nats.connect();

    // Simulate receiving a message from another container
    if (subscribeIteratorResolve) {
      const foreignEvent = { ...makeEvent(), _originId: 'other-container-id' };
      subscribeIteratorResolve({
        subject: 'lt.events.workflow.completed',
        data: new TextEncoder().encode(JSON.stringify(foreignEvent)),
      });
      // Allow async iteration to process
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('workflow.completed');
  });

  it('skips events from same container (_originId dedup)', async () => {
    const nats = new NatsEventAdapter({ url: 'nats://localhost:4222' });
    const callback = new CallbackEventAdapter();

    const received: LTEvent[] = [];
    callback.on('workflow.completed', (e) => received.push(e));

    nats.setCallbackBridge(callback);
    await nats.connect();

    // Publish an event to capture this container's _originId
    await nats.publish(makeEvent());
    const ownOriginId = JSON.parse(new TextDecoder().decode(mockMessages[0].data))._originId;

    // Simulate receiving the same event back from NATS (echo)
    if (subscribeIteratorResolve) {
      const echoEvent = { ...makeEvent(), _originId: ownOriginId };
      subscribeIteratorResolve({
        subject: 'lt.events.workflow.completed',
        data: new TextEncoder().encode(JSON.stringify(echoEvent)),
      });
      await new Promise((r) => setTimeout(r, 10));
    }

    // Should NOT have dispatched — it's our own event
    expect(received).toHaveLength(0);
  });
});

describe('NatsEventAdapter — adapter registration', () => {
  it('works without callback bridge (publish-only mode)', async () => {
    const adapter = new NatsEventAdapter({ url: 'nats://localhost:4222' });
    await adapter.connect();
    await adapter.publish(makeEvent());

    expect(mockMessages).toHaveLength(1);
  });

  it('uses custom subject prefix', async () => {
    const adapter = new NatsEventAdapter({ url: 'nats://localhost:4222', subjectPrefix: 'custom.events' });
    await adapter.connect();
    await adapter.publish(makeEvent({ type: 'task.created' }));

    expect(mockMessages[0].subject).toBe('custom.events.task.created');
  });
});
