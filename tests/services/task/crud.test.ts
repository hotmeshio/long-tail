import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockPublishTaskEvent = vi.fn();

vi.mock('../../../lib/db', () => ({
  getPool: vi.fn(() => ({ query: mockQuery })),
}));
vi.mock('../../../lib/events/publish', () => ({
  publishTaskEvent: (...args: any[]) => mockPublishTaskEvent(...args),
}));

import { createTask } from '../../../services/task/crud';
import { CREATE_TASK } from '../../../services/task/sql';

const baseInput = {
  workflow_id: 'wf-1',
  workflow_type: 'reviewContent',
  lt_type: 'reviewContent',
  signal_id: 'sig-1',
  parent_workflow_id: 'wf-1',
  envelope: '{}',
};

beforeEach(() => {
  mockQuery.mockReset();
  mockPublishTaskEvent.mockReset();
});

describe('createTask — idempotent upsert', () => {
  it('issues the ON CONFLICT (workflow_id) upsert against lt_tasks', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 't1', workflow_id: 'wf-1', status: 'pending', _inserted: true }],
    });

    await createTask(baseInput);

    expect(mockQuery).toHaveBeenCalledWith(CREATE_TASK, expect.any(Array));
    expect(CREATE_TASK).toContain('ON CONFLICT (workflow_id)');
    expect(CREATE_TASK).toContain('(xmax = 0) AS _inserted');
  });

  it('publishes task.created exactly once on a real insert (xmax = 0)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 't1', workflow_id: 'wf-1', status: 'pending', _inserted: true }],
    });

    await createTask(baseInput);

    expect(mockPublishTaskEvent).toHaveBeenCalledTimes(1);
    expect(mockPublishTaskEvent.mock.calls[0][0]).toMatchObject({ type: 'task.created' });
  });

  it('suppresses the created event when a retry conflicts (no duplicate row, no duplicate event)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 't1', workflow_id: 'wf-1', status: 'in_progress', _inserted: false }],
    });

    await createTask(baseInput);

    expect(mockPublishTaskEvent).not.toHaveBeenCalled();
  });

  it('strips the _inserted sentinel from the returned record', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 't1', workflow_id: 'wf-1', status: 'pending', _inserted: true }],
    });

    const task = await createTask(baseInput);

    expect(task).not.toHaveProperty('_inserted');
    expect(task).toMatchObject({ id: 't1', workflow_id: 'wf-1' });
  });
});
