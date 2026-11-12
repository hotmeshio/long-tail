import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/task/resolve', () => ({
  resolveWorkflowHandle: vi.fn().mockResolvedValue({ taskQueue: 'q', workflowName: 'reviewOrder' }),
}));
vi.mock('../../../services/export/client', () => ({ getHandle: vi.fn() }));
vi.mock('../../../services/export', () => ({ exportWorkflowExecution: vi.fn() }));
vi.mock('../../../services/escalation', () => ({ cancelEscalationsByWorkflowId: vi.fn().mockResolvedValue(2) }));

import { createHotMeshProvider } from '../../../services/durable-provider/hotmesh';
import { getHandle } from '../../../services/export/client';
import { exportWorkflowExecution } from '../../../services/export';
import { cancelEscalationsByWorkflowId } from '../../../services/escalation';

const mockGetHandle = getHandle as unknown as ReturnType<typeof vi.fn>;

function handleWithStatus(status: number, state: Record<string, unknown> = {}) {
  return { status: vi.fn().mockResolvedValue(status), state: vi.fn().mockResolvedValue(state), terminate: vi.fn() };
}

describe('HotMesh provider', () => {
  const provider = createHotMeshProvider();

  beforeEach(() => vi.clearAllMocks());

  it('is native with every capability', () => {
    expect(provider.name).toBe('hotmesh');
    expect(provider.capabilities).toEqual({ native: true, execution: true, terminate: true, list: true });
  });

  it('never delivers: HotMesh rows wake through signal_key', async () => {
    await expect(provider.deliver({ provider: 'hotmesh', workflowId: 'w', runScope: '', waitKey: 'k' }, {
      waitKey: 'k', escalationId: 'e', status: 'resolved',
    })).rejects.toThrow(/signal_key/);
  });

  it('describes a running workflow', async () => {
    mockGetHandle.mockResolvedValue(handleWithStatus(3));
    const status = await provider.describe('wf-1');
    expect(status).toMatchObject({ workflowId: 'wf-1', workflowType: 'reviewOrder', state: 'running', providerState: '3' });
  });

  it('describes a completed workflow', async () => {
    mockGetHandle.mockResolvedValue(handleWithStatus(0, {}));
    expect((await provider.describe('wf-2')).state).toBe('completed');
  });

  it('describes a terminated workflow', async () => {
    mockGetHandle.mockResolvedValue(handleWithStatus(-1, {}));
    expect((await provider.describe('wf-3')).state).toBe('terminated');
  });

  it('exports through the existing execution export', async () => {
    (exportWorkflowExecution as any).mockResolvedValue({ workflow_id: 'wf-4', events: [] });
    const execution = await provider.export!('wf-4', { excludeSystem: true, mode: 'sparse' });
    expect(execution.workflow_id).toBe('wf-4');
    expect(exportWorkflowExecution).toHaveBeenCalledWith('wf-4', 'q', 'reviewOrder', expect.objectContaining({ exclude_system: true, mode: 'sparse' }));
  });

  it('terminates and cancels the workflow escalations', async () => {
    const handle = handleWithStatus(1);
    mockGetHandle.mockResolvedValue(handle);
    await provider.terminate!('wf-5', 'reason');
    expect(handle.terminate).toHaveBeenCalled();
    expect(cancelEscalationsByWorkflowId).toHaveBeenCalledWith('wf-5');
  });
});
