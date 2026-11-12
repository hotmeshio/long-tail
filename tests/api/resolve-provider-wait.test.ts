import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A row a Temporal/DBOS workflow waits on resolves with the plain guarded
// resolve; the relay delivers. No HotMesh signal, triage or re-run runs.
vi.mock('../../services/escalation');
vi.mock('../../services/user');
vi.mock('../../services/task');
vi.mock('../../services/escalation-strategy', () => ({ escalationStrategyRegistry: { current: null } }));
vi.mock('../../services/yaml-workflow/deployer', () => ({ getEngine: vi.fn() }));
vi.mock('../../lib/events/publish', () => ({ publishEscalationEvent: vi.fn() }));
vi.mock('../../services/role/enforcement-cache', () => ({
  getEnforcingRoles: vi.fn().mockResolvedValue(new Set()),
  getEnforcedFormSchema: vi.fn(),
}));
const getHandle = vi.fn();
vi.mock('../../workers', () => ({ createClient: () => ({ workflow: { getHandle, start: vi.fn() } }) }));
const getWaitByEscalationId = vi.fn();
const kickDurableRelay = vi.fn();
vi.mock('../../services/durable-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/durable-provider')>()),
  getWaitByEscalationId: (...a: any[]) => getWaitByEscalationId(...a),
  kickDurableRelay: () => kickDurableRelay(),
}));

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { resolveEscalation } from '../../api/escalations/resolve';
import { durableProviderRegistry } from '../../services/durable-provider';
import { FakeDurableProvider } from '../helpers/fake-durable-provider';

const AUTH = { userId: 'user-uuid' };
// Shaped like a HotMesh signal row, so only the provider branch keeps it off Path A.
const ROW = {
  id: 'esc-1', status: 'pending', role: 'reviewer', workflow_id: 'wf-1', workflow_type: 'reviewOrder',
  task_queue: 'orders', metadata: { signal_id: 'sig-1' }, envelope: '{}', escalation_payload: null, assigned_to: null,
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userService.hasGlobalEscalationAccess).mockResolvedValue(true);
  vi.mocked(userService.getUserRoles).mockResolvedValue([]);
  vi.mocked(escalationService.getEscalation).mockResolvedValue(ROW);
  vi.mocked(escalationService.resolveEscalation).mockResolvedValue({ ...ROW, status: 'resolved' });
  durableProviderRegistry.register(new FakeDurableProvider('temporal'));
});
afterEach(() => durableProviderRegistry.clear());

describe('resolve: provider waits', () => {
  it('resolves the row, kicks the relay and sends no HotMesh signal', async () => {
    getWaitByEscalationId.mockResolvedValue({ escalation_id: 'esc-1' });
    const result = await resolveEscalation({ id: 'esc-1', resolverPayload: { approved: true } }, AUTH);
    expect(result).toEqual({ status: 200, data: { acknowledged: true, escalationId: 'esc-1' } });
    expect(escalationService.resolveEscalation).toHaveBeenCalledWith('esc-1', { approved: true }, expect.objectContaining({ resolved_by: 'user-uuid' }), 'user-uuid');
    expect(kickDurableRelay).toHaveBeenCalled();
    expect(getHandle).not.toHaveBeenCalled();
  });

  it('returns 409 when the guarded resolve finds the row already closed', async () => {
    getWaitByEscalationId.mockResolvedValue({ escalation_id: 'esc-1' });
    vi.mocked(escalationService.resolveEscalation).mockResolvedValue(null);
    const result = await resolveEscalation({ id: 'esc-1', resolverPayload: {} }, AUTH);
    expect(result.status).toBe(409);
    expect(kickDurableRelay).not.toHaveBeenCalled();
  });

  it('skips the wait lookup on HotMesh', async () => {
    durableProviderRegistry.clear();
    getHandle.mockResolvedValue({ signal: vi.fn() });
    await resolveEscalation({ id: 'esc-1', resolverPayload: {} }, AUTH);
    expect(getWaitByEscalationId).not.toHaveBeenCalled();
  });
});
