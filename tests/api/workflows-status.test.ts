import { describe, it, expect, vi, beforeEach } from 'vitest';

// Status and result share one state reading; the numeric status stays for existing callers.
const mockResolve = vi.fn();
const mockGetHandle = vi.fn();

vi.mock('../../services/task', () => ({
  resolveWorkflowHandle: (...a: unknown[]) => mockResolve(...a),
}));
vi.mock('../../workers', () => ({
  createClient: () => ({ workflow: { getHandle: (...a: unknown[]) => mockGetHandle(...a) } }),
}));

import { getWorkflowStatus, getWorkflowResult } from '../../api/workflows/invocation';

function handleWith(status: number, state: Record<string, any> = {}, result: unknown = undefined) {
  return {
    status: vi.fn().mockResolvedValue(status),
    state: vi.fn().mockResolvedValue(state),
    result: vi.fn().mockResolvedValue(result),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolve.mockResolvedValue({ taskQueue: 'q', workflowName: 'flow' });
});

describe('getWorkflowStatus', () => {
  it('keeps the numeric status and adds state and terminated', async () => {
    mockGetHandle.mockResolvedValue(handleWith(3));
    const result = await getWorkflowStatus({ workflowId: 'wf-1' });
    expect(result).toEqual({ status: 200, data: { workflowId: 'wf-1', status: 3, state: 'running', terminated: false } });
  });

  it('a run that closed with an error reports failed at status 0', async () => {
    mockGetHandle.mockResolvedValue(handleWith(0, { $error: { message: 'boom' } }));
    const result = await getWorkflowStatus({ workflowId: 'wf-2' });
    expect(result.data).toEqual({ workflowId: 'wf-2', status: 0, state: 'failed', terminated: false, error: 'boom' });
  });

  it('a terminated run reports failed and terminated', async () => {
    mockGetHandle.mockResolvedValue(handleWith(-1_000_000_001, { $error: { message: 'Job Interrupted' } }));
    const result = await getWorkflowStatus({ workflowId: 'wf-3' });
    expect(result.data).toMatchObject({ status: -1_000_000_001, state: 'failed', terminated: true });
  });

  it('an unresolvable workflow is 404', async () => {
    mockResolve.mockRejectedValue(new Error('Cannot resolve workflow ghost'));
    expect((await getWorkflowStatus({ workflowId: 'ghost' })).status).toBe(404);
  });
});

describe('getWorkflowResult', () => {
  it('a running run is 202 and never reads the result', async () => {
    const handle = handleWith(1);
    mockGetHandle.mockResolvedValue(handle);
    const result = await getWorkflowResult({ workflowId: 'wf-1' });
    expect(result).toEqual({ status: 202, data: { workflowId: 'wf-1', status: 'running' } });
    expect(handle.result).not.toHaveBeenCalled();
  });

  it('a completed run returns its result', async () => {
    mockGetHandle.mockResolvedValue(handleWith(0, {}, { ok: true }));
    const result = await getWorkflowResult({ workflowId: 'wf-2' });
    expect(result).toEqual({ status: 200, data: { workflowId: 'wf-2', state: 'completed', result: { ok: true } } });
  });

  it('a failed run returns its error with a null result, without awaiting it', async () => {
    const handle = handleWith(0, { $error: { message: 'boom' } });
    mockGetHandle.mockResolvedValue(handle);
    const result = await getWorkflowResult({ workflowId: 'wf-3' });
    expect(result).toEqual({
      status: 200,
      data: { workflowId: 'wf-3', state: 'failed', terminated: false, error: 'boom', result: null },
    });
    expect(handle.result).not.toHaveBeenCalled();
  });

  it('a terminated run is failed and terminated', async () => {
    mockGetHandle.mockResolvedValue(handleWith(-1_000_000_001));
    const result = await getWorkflowResult({ workflowId: 'wf-4' });
    expect(result.data).toEqual({ workflowId: 'wf-4', state: 'failed', terminated: true, result: null });
  });
});
