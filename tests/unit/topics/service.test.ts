import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

vi.mock('../../../lib/db', () => ({
  getPool: vi.fn(() => ({ query: mockQuery })),
}));

import {
  listTopics,
  getTopic,
  createTopic,
  updateTopic,
  deleteTopic,
  upsertTopicOnPublish,
  seedTopic,
  resetTopic,
} from '../../../services/topics';

describe('listTopics', () => {
  beforeEach(() => mockQuery.mockReset());

  it('returns topics and total from parallel queries', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ topic: 'task.created' }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const result = await listTopics();
    expect(result.topics).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('passes category and search filters', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await listTopics({ category: 'task', search: 'created' });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe('task');
    expect(params[1]).toBe('created');
  });

  it('defaults to limit 50, offset 0', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await listTopics();
    const [, params] = mockQuery.mock.calls[0];
    expect(params[2]).toBe(50); // limit
    expect(params[3]).toBe(0);  // offset
  });
});

describe('getTopic', () => {
  beforeEach(() => mockQuery.mockReset());

  it('returns null when topic not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await getTopic('nonexistent');
    expect(result).toBeNull();
  });

  it('returns topic with subscribers', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ topic: 'task.created', category: 'task' }] })
      .mockResolvedValueOnce({ rows: [
        { id: 's1', agent_id: 'a1', agent_name: 'watcher', topic: 'task.*', reaction_type: 'durable' },
      ] });

    const result = await getTopic('task.created');
    expect(result).not.toBeNull();
    expect(result!.topic).toBe('task.created');
    // task.* matches task.created
    expect(result!.subscribers).toHaveLength(1);
    expect(result!.subscribers[0].agent_name).toBe('watcher');
  });

  it('filters subscribers by pattern match', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ topic: 'task.created', category: 'task' }] })
      .mockResolvedValueOnce({ rows: [
        { id: 's1', agent_id: 'a1', agent_name: 'all-tasks', topic: 'task.*', reaction_type: 'durable' },
        { id: 's2', agent_id: 'a2', agent_name: 'app-watcher', topic: 'app.>', reaction_type: 'durable' },
      ] });

    const result = await getTopic('task.created');
    // task.* matches, app.> does not
    expect(result!.subscribers).toHaveLength(1);
    expect(result!.subscribers[0].agent_name).toBe('all-tasks');
  });
});

describe('createTopic', () => {
  beforeEach(() => mockQuery.mockReset());

  it('inserts and returns the created topic', async () => {
    const created = { topic: 'app.orders.created', category: 'app' };
    mockQuery.mockResolvedValueOnce({ rows: [created] });

    const result = await createTopic({ topic: 'app.orders.created', category: 'app' });
    expect(result.topic).toBe('app.orders.created');
  });

  it('defaults source to "app"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{}] });
    await createTopic({ topic: 'app.test', category: 'app' });
    const source = mockQuery.mock.calls[0][1][5];
    expect(source).toBe('app');
  });
});

describe('updateTopic', () => {
  beforeEach(() => mockQuery.mockReset());

  it('returns updated topic', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ topic: 'task.created', description: 'updated' }] });
    const result = await updateTopic('task.created', { description: 'updated' });
    expect(result).not.toBeNull();
    expect(result!.description).toBe('updated');
  });

  it('returns null when topic not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await updateTopic('nonexistent', { description: 'x' });
    expect(result).toBeNull();
  });
});

describe('deleteTopic', () => {
  beforeEach(() => mockQuery.mockReset());

  it('returns true when deleted', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    expect(await deleteTopic('app.test')).toBe(true);
  });

  it('returns false when not found or system topic', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    expect(await deleteTopic('task.created')).toBe(false);
  });
});

describe('upsertTopicOnPublish', () => {
  beforeEach(() => mockQuery.mockReset());

  it('infers category "app" for app-prefixed topics', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await upsertTopicOnPublish('app.vendor.orders.error', { orderId: '123' });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe('app.vendor.orders.error');
    expect(params[1]).toBe('app');
  });

  it('infers category from first segment for non-app topics', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await upsertTopicOnPublish('custom.event', {});
    expect(mockQuery.mock.calls[0][1][1]).toBe('custom');
  });

  it('passes source through', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await upsertTopicOnPublish('app.test', {}, 'my-workflow');
    expect(mockQuery.mock.calls[0][1][2]).toBe('my-workflow');
  });

  it('serializes data as JSON', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await upsertTopicOnPublish('app.test', { key: 'value' });
    const dataParam = mockQuery.mock.calls[0][1][3];
    expect(JSON.parse(dataParam)).toEqual({ key: 'value' });
  });
});

describe('seedTopic', () => {
  beforeEach(() => mockQuery.mockReset());

  it('returns true when inserted', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const inserted = await seedTopic({ topic: 'test', description: 'Test', category: 'app' });
    expect(inserted).toBe(true);
  });

  it('returns false when already exists', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const inserted = await seedTopic({ topic: 'test', description: 'Test', category: 'app' });
    expect(inserted).toBe(false);
  });
});

describe('resetTopic', () => {
  beforeEach(() => mockQuery.mockReset());

  it('uses RESET_TOPIC SQL (ON CONFLICT DO UPDATE)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await resetTopic({ topic: 'test', description: 'Test', category: 'app' });
    expect(mockQuery.mock.calls[0][0]).toContain('DO UPDATE');
  });
});
