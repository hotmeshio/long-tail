import { describe, it, expect, vi, beforeEach } from 'vitest';

// A YAML invoke's execute_as override follows the same rule as a workflow
// invoke: it may not exceed the caller's own authority.
const mocks = vi.hoisted(() => ({
  getYamlWorkflow: vi.fn(),
  invokeService: vi.fn(),
  assertMayActAs: vi.fn(),
}));
vi.mock('../../services/yaml-workflow/db', () => ({ getYamlWorkflow: mocks.getYamlWorkflow }));
vi.mock('../../services/yaml-workflow/deployer', () => ({}));
vi.mock('../../services/yaml-workflow/workers', () => ({}));
vi.mock('../../services/yaml-workflow/invoke', () => ({ invokeYamlWorkflow: mocks.invokeService }));
vi.mock('../../services/workflow-invocation', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  assertMayActAs: mocks.assertMayActAs,
}));

import { invokeYamlWorkflow } from '../../api/yaml-workflows/deploy';
import { InvocationError } from '../../services/workflow-invocation';

const AUTH = { userId: '11111111-1111-4111-8111-111111111111' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getYamlWorkflow.mockResolvedValue({ id: 'y1', status: 'active', app_id: 'a', graph_topic: 't' });
  mocks.invokeService.mockResolvedValue({ job_id: 'j1' });
});

describe('invokeYamlWorkflow execute_as', () => {
  it('without execute_as, no authority check runs', async () => {
    expect((await invokeYamlWorkflow({ id: 'y1', data: {} }, AUTH)).status).toBe(200);
    expect(mocks.assertMayActAs).not.toHaveBeenCalled();
  });

  it('an allowed override is checked, then invoked', async () => {
    mocks.assertMayActAs.mockResolvedValue(undefined);
    expect((await invokeYamlWorkflow({ id: 'y1', execute_as: 'fleet-bot' }, AUTH)).status).toBe(200);
    expect(mocks.assertMayActAs).toHaveBeenCalledWith(AUTH.userId, 'fleet-bot');
  });

  it('an override above the caller is refused and nothing runs', async () => {
    mocks.assertMayActAs.mockRejectedValue(new InvocationError('execute_as may not exceed your own authority', 403));
    const result = await invokeYamlWorkflow({ id: 'y1', execute_as: 'superadmin' }, AUTH);
    expect(result).toEqual({ status: 403, error: 'execute_as may not exceed your own authority' });
    expect(mocks.invokeService).not.toHaveBeenCalled();
  });

  it('an override with no authenticated caller is refused', async () => {
    expect((await invokeYamlWorkflow({ id: 'y1', execute_as: 'fleet-bot' })).status).toBe(403);
    expect(mocks.invokeService).not.toHaveBeenCalled();
  });
});
