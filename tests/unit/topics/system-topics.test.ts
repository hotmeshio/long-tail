import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB pool and logger before importing the module under test
vi.mock('../../../lib/db', () => ({
  getPool: vi.fn(() => ({
    query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [] }),
  })),
}));

vi.mock('../../../lib/logger', () => ({
  loggerRegistry: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { seedSystemTopics, seedConfigTopics } from '../../../services/topics/system-topics';
import { getPool } from '../../../lib/db';
import { loggerRegistry } from '../../../lib/logger';

const EXPECTED_SYSTEM_TOPICS = [
  'task.created', 'task.started', 'task.completed', 'task.escalated', 'task.failed',
  'workflow.started', 'workflow.completed', 'workflow.failed',
  'escalation.created', 'escalation.resolved', 'escalation.claimed', 'escalation.released',
  'activity.started', 'activity.completed', 'activity.failed',
  'knowledge.stored', 'knowledge.deleted',
  'file.stored', 'file.deleted',
  'agent.started', 'agent.completed', 'agent.failed', 'agent.status_changed',
  'milestone',
];

describe('seedSystemTopics', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    (getPool as any).mockReturnValue({ query: mockQuery });
  });

  it('seeds all 24 built-in topics', async () => {
    await seedSystemTopics();
    expect(mockQuery).toHaveBeenCalledTimes(24);
  });

  it('seeds every expected topic name', async () => {
    await seedSystemTopics();
    const seededTopics = mockQuery.mock.calls.map((call: any[]) => call[1][0]);
    expect(seededTopics.sort()).toEqual(EXPECTED_SYSTEM_TOPICS.sort());
  });

  it('uses source "system" for all topics', async () => {
    await seedSystemTopics();
    for (const call of mockQuery.mock.calls) {
      const source = call[1][5]; // 6th param is source
      expect(source).toBe('system');
    }
  });

  it('every topic has a description', async () => {
    await seedSystemTopics();
    for (const call of mockQuery.mock.calls) {
      const description = call[1][1]; // 2nd param is description
      expect(description).toBeTruthy();
      expect(typeof description).toBe('string');
    }
  });

  it('every topic has a valid category', async () => {
    const validCategories = ['task', 'workflow', 'escalation', 'activity', 'knowledge', 'file', 'agent', 'milestone'];
    await seedSystemTopics();
    for (const call of mockQuery.mock.calls) {
      const category = call[1][2]; // 3rd param
      expect(validCategories).toContain(category);
    }
  });

  it('every topic has a payload_schema with properties', async () => {
    await seedSystemTopics();
    for (const call of mockQuery.mock.calls) {
      const schemaJson = call[1][3]; // 4th param
      expect(schemaJson).toBeTruthy();
      const schema = JSON.parse(schemaJson);
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeDefined();
    }
  });

  it('every topic has tags', async () => {
    await seedSystemTopics();
    for (const call of mockQuery.mock.calls) {
      const tags = call[1][6]; // 7th param
      expect(Array.isArray(tags)).toBe(true);
      expect(tags.length).toBeGreaterThan(0);
    }
  });

  it('logs seeded topics', async () => {
    await seedSystemTopics();
    expect(loggerRegistry.info).toHaveBeenCalledTimes(24);
  });

  it('continues seeding after individual failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error'));
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] });
    await seedSystemTopics();
    // 1 failed + 23 succeeded = 24 calls
    expect(mockQuery).toHaveBeenCalledTimes(24);
    expect(loggerRegistry.warn).toHaveBeenCalledTimes(1);
  });
});

describe('seedConfigTopics', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    (getPool as any).mockReturnValue({ query: mockQuery });
  });

  it('seeds config topics with insert-if-absent by default', async () => {
    await seedConfigTopics([
      { topic: 'app.orders.created', description: 'Order created' },
    ]);
    expect(mockQuery).toHaveBeenCalledOnce();
    // SEED_TOPIC uses ON CONFLICT DO NOTHING
    expect(mockQuery.mock.calls[0][0]).toContain('DO NOTHING');
  });

  it('uses reset SQL when reset: true', async () => {
    await seedConfigTopics([
      { topic: 'app.orders.created', description: 'Order created', reset: true },
    ]);
    expect(mockQuery).toHaveBeenCalledOnce();
    // RESET_TOPIC uses ON CONFLICT DO UPDATE
    expect(mockQuery.mock.calls[0][0]).toContain('DO UPDATE');
  });

  it('infers category "app" for app.* topics', async () => {
    await seedConfigTopics([
      { topic: 'app.vendor.orders.created' },
    ]);
    const category = mockQuery.mock.calls[0][1][2];
    expect(category).toBe('app');
  });

  it('infers category from first segment for non-app topics', async () => {
    await seedConfigTopics([
      { topic: 'billing.invoice.paid', category: undefined },
    ]);
    const category = mockQuery.mock.calls[0][1][2];
    expect(category).toBe('billing');
  });

  it('uses explicit category when provided', async () => {
    await seedConfigTopics([
      { topic: 'app.orders.created', category: 'workflow' },
    ]);
    const category = mockQuery.mock.calls[0][1][2];
    expect(category).toBe('workflow');
  });

  it('uses source "config" for all config topics', async () => {
    await seedConfigTopics([
      { topic: 'app.orders.created' },
      { topic: 'app.billing.paid' },
    ]);
    for (const call of mockQuery.mock.calls) {
      expect(call[1][5]).toBe('config');
    }
  });

  it('logs reset vs seeded correctly', async () => {
    await seedConfigTopics([
      { topic: 'app.a', reset: true },
      { topic: 'app.b' },
    ]);
    const infoMessages = (loggerRegistry.info as any).mock.calls.map((c: any) => c[0]);
    expect(infoMessages.some((m: string) => m.includes('topic reset:'))).toBe(true);
    expect(infoMessages.some((m: string) => m.includes('topic seeded:'))).toBe(true);
  });
});
