import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockGetWorkers = vi.fn(() => new Map());

vi.mock('../../../lib/db', () => ({
  getPool: vi.fn(() => ({ query: mockQuery })),
}));
vi.mock('../../../services/workers/registry', () => ({
  getRegisteredWorkers: () => mockGetWorkers(),
}));

import { resolveWorkflowHandle } from '../../../services/task/resolve';

beforeEach(() => {
  mockQuery.mockReset();
  mockGetWorkers.mockReset();
  mockGetWorkers.mockReturnValue(new Map());
});

describe('resolveWorkflowHandle', () => {
  it('resolves a leaf workflow from lt_tasks (task_queue present)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ workflow_type: 'reviewContent', task_queue: 'tq-1' }] });

    const handle = await resolveWorkflowHandle('wf-1');
    expect(handle).toEqual({ taskQueue: 'tq-1', workflowName: 'reviewContent' });
  });

  it('scans the durable namespace by default for the job-entity fallback', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                              // lt_tasks miss
      .mockResolvedValueOnce({ rows: [{ entity: 'orchestrator' }] })   // <appId>.jobs hit
      .mockResolvedValueOnce({ rows: [{ task_queue: 'tq-orch' }] });   // config task_queue

    const handle = await resolveWorkflowHandle('wf-2');
    expect(handle).toEqual({ taskQueue: 'tq-orch', workflowName: 'orchestrator' });

    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain('"durable".jobs');
    expect(params[0]).toBe('hmsh:durable:j:wf-2');
  });

  it('scans the supplied namespace for a child running in another app', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                              // lt_tasks miss
      .mockResolvedValueOnce({ rows: [{ entity: 'childFlow' }] })      // <appId>.jobs hit
      .mockResolvedValueOnce({ rows: [{ task_queue: 'tq-child' }] });  // config task_queue

    const handle = await resolveWorkflowHandle('child-1', 'other-app');
    expect(handle).toEqual({ taskQueue: 'tq-child', workflowName: 'childFlow' });

    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain('"other-app".jobs');
    expect(params[0]).toBe('hmsh:other-app:j:child-1');
  });

  it('throws when nothing resolves', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // lt_tasks miss
      .mockResolvedValueOnce({ rows: [] }); // jobs miss

    await expect(resolveWorkflowHandle('ghost', 'durable')).rejects.toThrow(/Cannot resolve workflow/);
  });
});
