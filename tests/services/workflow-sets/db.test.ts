import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../../../lib/db', () => ({
  getPool: vi.fn().mockReturnValue({ query: (...args: any[]) => mockQuery(...args) }),
}));

import {
  createWorkflowSet,
  getWorkflowSet,
  updateWorkflowSetPlan,
  updateWorkflowSetStatus,
  deleteWorkflowSet,
  listWorkflowSets,
} from '../../../services/workflow-sets/db';

beforeEach(() => {
  vi.clearAllMocks();
});

// ── createWorkflowSet ───────────────────────────────────────────────────────

describe('createWorkflowSet', () => {
  it('inserts a workflow set and returns the record', async () => {
    const record = { id: 'uuid-1', name: 'test-set', status: 'planning' };
    mockQuery.mockResolvedValue({ rows: [record] });

    const result = await createWorkflowSet({
      name: 'test-set',
      specification: 'Build a referral intake system',
    });

    expect(result).toEqual(record);
    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO lt_workflow_sets');
    expect(params[0]).toBe('test-set');
    expect(params[2]).toBe('Build a referral intake system');
  });

  it('passes optional fields through', async () => {
    const record = { id: 'uuid-2', name: 'named-set', status: 'planning' };
    mockQuery.mockResolvedValue({ rows: [record] });

    await createWorkflowSet({
      name: 'named-set',
      description: 'A test set',
      specification: 'spec text',
      plan: [{ name: 'wf-1', description: 'd', namespace: 'ns', role: 'leaf', dependencies: [], build_order: 0, io_contract: { input_schema: {}, output_schema: {} } }],
      namespaces: ['ns'],
      source_workflow_id: 'wf-planner-123',
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe('A test set');
    expect(params[4]).toEqual(['ns']);
    expect(params[5]).toBe('wf-planner-123');
  });
});

// ── getWorkflowSet ──────────────────────────────────────────────────────────

describe('getWorkflowSet', () => {
  it('returns the record when found', async () => {
    const record = { id: 'uuid-1', name: 'test-set' };
    mockQuery.mockResolvedValue({ rows: [record] });

    const result = await getWorkflowSet('uuid-1');
    expect(result).toEqual(record);
  });

  it('returns null when not found', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await getWorkflowSet('nonexistent');
    expect(result).toBeNull();
  });
});

// ── updateWorkflowSetPlan ───────────────────────────────────────────────────

describe('updateWorkflowSetPlan', () => {
  it('updates plan and namespaces, sets status to planned', async () => {
    const record = { id: 'uuid-1', status: 'planned' };
    mockQuery.mockResolvedValue({ rows: [record] });

    const plan = [{ name: 'wf-1', description: 'd', namespace: 'ns', role: 'leaf' as const, dependencies: [], build_order: 0, io_contract: { input_schema: {}, output_schema: {} } }];
    const result = await updateWorkflowSetPlan('uuid-1', plan, ['ns']);

    expect(result?.status).toBe('planned');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'planned'");
  });
});

// ── updateWorkflowSetStatus ─────────────────────────────────────────────────

describe('updateWorkflowSetStatus', () => {
  it('transitions status', async () => {
    const record = { id: 'uuid-1', status: 'building' };
    mockQuery.mockResolvedValue({ rows: [record] });

    const result = await updateWorkflowSetStatus('uuid-1', 'building');
    expect(result?.status).toBe('building');
  });
});

// ── deleteWorkflowSet ───────────────────────────────────────────────────────

describe('deleteWorkflowSet', () => {
  it('returns true when a row is deleted', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });
    expect(await deleteWorkflowSet('uuid-1')).toBe(true);
  });

  it('returns false when no row matches', async () => {
    mockQuery.mockResolvedValue({ rowCount: 0 });
    expect(await deleteWorkflowSet('nonexistent')).toBe(false);
  });
});

// ── listWorkflowSets ────────────────────────────────────────────────────────

describe('listWorkflowSets', () => {
  it('returns paginated results', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '3' }] })
      .mockResolvedValueOnce({ rows: [{ id: '1' }, { id: '2' }] });

    const result = await listWorkflowSets({ limit: 2, offset: 0 });
    expect(result.total).toBe(3);
    expect(result.sets).toHaveLength(2);
  });

  it('applies status filter', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ id: '1', status: 'completed' }] });

    await listWorkflowSets({ status: 'completed' });

    const [countSql] = mockQuery.mock.calls[0];
    expect(countSql).toContain('status = $1');
  });

  it('applies search filter', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ id: '1' }] });

    await listWorkflowSets({ search: 'referral' });

    const [countSql, params] = mockQuery.mock.calls[0];
    expect(countSql).toContain('ILIKE');
    expect(params[0]).toBe('%referral%');
  });
});
