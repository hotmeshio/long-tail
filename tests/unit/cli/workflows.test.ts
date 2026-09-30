import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/cli/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../lib/cli/format', () => ({ output: vi.fn(), formatStatus: vi.fn((v: string) => v) }));

import { apiFetch } from '../../../lib/cli/client';
import { getWorkflowStatus, terminateWorkflow } from '../../../lib/cli/commands/workflows';

const fetchMock = vi.mocked(apiFetch);
let logged: string[];

beforeEach(() => {
  vi.clearAllMocks();
  logged = [];
  vi.spyOn(console, 'log').mockImplementation((line?: unknown) => { logged.push(String(line)); });
});

describe('ltc workflows status and terminate', () => {
  it('status calls the per-workflow status route', async () => {
    fetchMock.mockResolvedValue({ workflowId: 'wf/1', status: 1, state: 'running', terminated: false } as any);
    await getWorkflowStatus('wf/1', {});
    expect(fetchMock).toHaveBeenCalledWith('/workflows/wf%2F1/status');
  });

  it('status prints a terminated run as failed (terminated) with its error', async () => {
    fetchMock.mockResolvedValue({ workflowId: 'wf-2', state: 'failed', terminated: true, error: 'Job Interrupted' } as any);
    await getWorkflowStatus('wf-2', {});
    expect(logged.join('\n')).toContain('failed (terminated)');
    expect(logged.join('\n')).toContain('Job Interrupted');
  });

  it('terminate posts to the per-workflow terminate route', async () => {
    fetchMock.mockResolvedValue({ terminated: true } as any);
    await terminateWorkflow('wf-3');
    expect(fetchMock).toHaveBeenCalledWith('/workflows/wf-3/terminate', { method: 'POST' });
  });
});
