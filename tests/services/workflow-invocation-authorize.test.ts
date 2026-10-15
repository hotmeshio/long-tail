import { describe, it, expect, vi, beforeEach } from 'vitest';

// External invocations are authorized from the caller's live grants: the
// workflow's invocation rules, superadmin for system-authority workflows, and
// an execute_as override that never exceeds the caller.
const mocks = vi.hoisted(() => ({
  getWorkflowConfig: vi.fn(),
  getUser: vi.fn(),
  getUserByExternalId: vi.fn(),
}));
vi.mock('../../services/config', () => ({ getWorkflowConfig: mocks.getWorkflowConfig }));
vi.mock('../../services/user', () => ({ getUser: mocks.getUser, getUserByExternalId: mocks.getUserByExternalId }));
vi.mock('../../workers', () => ({ createClient: vi.fn() }));

import { authorizeInvocation, checkInvocationRoles } from '../../services/workflow-invocation';

const ME = '11111111-1111-4111-8111-111111111111';
const user = (roles: Array<{ role: string; type: string }>) => ({ id: ME, roles });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getWorkflowConfig.mockResolvedValue({ workflow_type: 'probe', invocable: true, invocation_roles: [] });
});

describe('checkInvocationRoles', () => {
  it('an open workflow needs no lookup', async () => {
    await checkInvocationRoles('probe', ME);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('capabilityInvoke is refused to a member even with no stored roles', async () => {
    mocks.getWorkflowConfig.mockResolvedValue({ workflow_type: 'capabilityInvoke', invocable: true, invocation_roles: [] });
    mocks.getUser.mockResolvedValue(user([{ role: 'reviewer', type: 'member' }]));
    await expect(checkInvocationRoles('capabilityInvoke', ME)).rejects.toThrow('Insufficient role for invocation');
  });

  it('capabilityInvoke is allowed to a live superadmin', async () => {
    mocks.getWorkflowConfig.mockResolvedValue({ workflow_type: 'capabilityInvoke', invocable: true, invocation_roles: [] });
    mocks.getUser.mockResolvedValue(user([{ role: 'superadmin', type: 'superadmin' }]));
    await expect(checkInvocationRoles('capabilityInvoke', ME)).resolves.toBeUndefined();
  });

  it('named roles are checked against live grants', async () => {
    mocks.getWorkflowConfig.mockResolvedValue({ workflow_type: 'probe', invocable: true, invocation_roles: ['fleet'] });
    mocks.getUser.mockResolvedValue(user([{ role: 'fleet', type: 'member' }]));
    await expect(checkInvocationRoles('probe', ME)).resolves.toBeUndefined();
    mocks.getUser.mockResolvedValue(user([{ role: 'bins', type: 'member' }]));
    await expect(checkInvocationRoles('probe', ME)).rejects.toThrow('Insufficient role for invocation');
  });

  it('an unknown or non-uuid caller is not registered', async () => {
    mocks.getWorkflowConfig.mockResolvedValue({ workflow_type: 'probe', invocable: true, invocation_roles: ['fleet'] });
    mocks.getUser.mockResolvedValue(null);
    await expect(checkInvocationRoles('probe', ME)).rejects.toThrow('User not registered');
    mocks.getUserByExternalId.mockResolvedValue(null);
    await expect(checkInvocationRoles('probe', 'not-a-uuid')).rejects.toThrow('User not registered');
  });
});

describe('authorizeInvocation execute_as', () => {
  it('an admin may act as a member it outranks', async () => {
    mocks.getUser.mockResolvedValue(user([{ role: 'fleet', type: 'admin' }]));
    mocks.getUserByExternalId.mockResolvedValue({ id: 'bot', roles: [{ role: 'fleet', type: 'member' }] });
    await expect(authorizeInvocation({ workflowType: 'probe', userId: ME, executeAs: 'fleet-bot' })).resolves.toBeUndefined();
  });

  it('an admin may not act as a superadmin', async () => {
    mocks.getUser.mockResolvedValue(user([{ role: 'fleet', type: 'admin' }]));
    mocks.getUserByExternalId.mockResolvedValue({ id: 'sa', roles: [{ role: 'superadmin', type: 'superadmin' }] });
    await expect(authorizeInvocation({ workflowType: 'probe', userId: ME, executeAs: 'superadmin' }))
      .rejects.toMatchObject({ statusCode: 403, message: 'execute_as may not exceed your own authority' });
  });

  it('an unknown execute_as principal is not found', async () => {
    mocks.getUser.mockResolvedValue(user([{ role: 'ops', type: 'superadmin' }]));
    mocks.getUserByExternalId.mockResolvedValue(null);
    await expect(authorizeInvocation({ workflowType: 'probe', userId: ME, executeAs: 'ghost' }))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});
