import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isValidVariant, publishTopic } from '../../api/topics';

// Mock the event registry so publishTopic doesn't need a real event bus
vi.mock('../../lib/events', () => ({
  eventRegistry: {
    publish: vi.fn().mockResolvedValue(undefined),
  },
}));

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
    const result = await publishTopic({ topic: 'knowledge.stored', data: { key: '1' } });
    expect(result.status).toBe(200);
    expect(result.data.topic).toBe('knowledge.stored');
  });

  it('publishes with valid subject variant', async () => {
    const result = await publishTopic({
      topic: 'order.*.completed',
      subject: 'order.123.completed',
      data: {},
    });
    expect(result.status).toBe(200);
    expect(result.data.topic).toBe('order.123.completed');
  });

  it('rejects invalid subject variant with 400', async () => {
    const result = await publishTopic({
      topic: 'order.*.completed',
      subject: 'order.123.456.completed',
      data: {},
    });
    expect(result.status).toBe(400);
    expect(result.error).toContain('does not match topic pattern');
  });

  it('rejects completely unrelated subject', async () => {
    const result = await publishTopic({
      topic: 'knowledge.stored',
      subject: 'workflow.completed',
      data: {},
    });
    expect(result.status).toBe(400);
  });
});
