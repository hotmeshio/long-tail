import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isValidVariant, publishTopic } from '../../api/topics';
import { eventRegistry } from '../../lib/events';

// Mock the event registry so publishTopic doesn't need a real event bus
vi.mock('../../lib/events', () => ({
  eventRegistry: {
    publish: vi.fn().mockResolvedValue(undefined),
  },
}));

const lastPublishedEvent = () =>
  vi.mocked(eventRegistry.publish).mock.calls.at(-1)?.[0] as any;

describe('isValidVariant', () => {
  it('exact match — no wildcards', () => {
    expect(isValidVariant('knowledge.stored', 'knowledge.stored')).toBe(true);
  });

  it('rejects non-matching literal', () => {
    expect(isValidVariant('knowledge.stored', 'knowledge.deleted')).toBe(false);
  });

  it('single * matches one segment', () => {
    expect(isValidVariant('order.*.completed', 'order.123.completed')).toBe(true);
  });

  it('* does not match zero segments', () => {
    expect(isValidVariant('order.*.completed', 'order.completed')).toBe(false);
  });

  it('* does not match multiple segments', () => {
    expect(isValidVariant('order.*.completed', 'order.123.456.completed')).toBe(false);
  });

  it('multiple * wildcards', () => {
    expect(isValidVariant('order.*.station.*.completed', 'order.123.station.grinder.completed')).toBe(true);
  });

  it('rejects when trailing segment missing', () => {
    expect(isValidVariant('order.*.station.*.completed', 'order.123.station.grinder')).toBe(false);
  });

  it('> matches one trailing segment', () => {
    expect(isValidVariant('order.>', 'order.123')).toBe(true);
  });

  it('> matches multiple trailing segments', () => {
    expect(isValidVariant('order.>', 'order.123.station.grinder.completed')).toBe(true);
  });

  it('mixed * and > pattern', () => {
    expect(isValidVariant('order.*.customer.>', 'order.123.customer.acme.region.us')).toBe(true);
  });

  it('rejects subject shorter than pattern', () => {
    expect(isValidVariant('a.b.c', 'a.b')).toBe(false);
  });

  it('rejects subject longer than pattern without >', () => {
    expect(isValidVariant('a.b', 'a.b.c')).toBe(false);
  });
});

describe('publishTopic — subject validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes with topic as subject when no subject provided', async () => {
    const result = await publishTopic({ topic: 'knowledge.stored', event: { data: { key: '1' } } });
    expect(result.status).toBe(200);
    expect(result.data.topic).toBe('knowledge.stored');
  });

  it('publishes with valid subject variant', async () => {
    const result = await publishTopic({
      topic: 'order.*.completed',
      event: { subject: 'order.123.completed', data: {} },
    });
    expect(result.status).toBe(200);
    expect(result.data.topic).toBe('order.123.completed');
  });

  it('rejects invalid subject variant with 400', async () => {
    const result = await publishTopic({
      topic: 'order.*.completed',
      event: { subject: 'order.123.456.completed', data: {} },
    });
    expect(result.status).toBe(400);
    expect(result.error).toContain('does not match topic pattern');
  });

  it('rejects completely unrelated subject', async () => {
    const result = await publishTopic({
      topic: 'knowledge.stored',
      event: { subject: 'workflow.completed', data: {} },
    });
    expect(result.status).toBe(400);
  });
});

describe('publishTopic — minimal envelope + opt-in extensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes a MINIMAL envelope (no empty workflow fields injected) when none are given', async () => {
    await publishTopic({ topic: 'system.workflow.*.failed', event: { data: { reason: 'boom' } } });
    const event = lastPublishedEvent();
    expect('workflowId' in event).toBe(false);
    expect('workflowName' in event).toBe(false);
    expect('taskQueue' in event).toBe(false);
    // the universal fields are present
    expect(event.type).toBe('system.workflow.*.failed');
    expect(event.timestamp).toBeTruthy();
  });

  it('passes through the envelope fields the caller set (so input_mapping tokens resolve)', async () => {
    await publishTopic({
      topic: 'system.workflow.*.failed',
      event: {
        subject: 'system.workflow.myWorkflow.failed',
        workflowId: 'wf-001',
        workflowName: 'myWorkflow',
        taskQueue: 'my-queue',
        status: 'failed',
        originId: 'origin-1',
        data: { reason: 'boom' },
      },
    });
    const event = lastPublishedEvent();
    expect(event.type).toBe('system.workflow.myWorkflow.failed');
    expect(event.workflowName).toBe('myWorkflow');
    expect(event.workflowId).toBe('wf-001');
    expect(event.taskQueue).toBe('my-queue');
    expect(event.status).toBe('failed');
    expect(event.originId).toBe('origin-1');
    expect(event.data).toEqual({ reason: 'boom' });
  });

  it('honours a caller-supplied id and omits fields not provided', async () => {
    await publishTopic({ topic: 'app.image.resized', event: { id: 'custom-1', data: { w: 100 } } });
    const event = lastPublishedEvent();
    expect(event.id).toBe('custom-1');
    expect('workflowName' in event).toBe(false);
    expect('status' in event).toBe(false);
    expect('taskId' in event).toBe(false);
  });
});
