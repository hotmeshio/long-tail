import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies — fast, no Postgres.
vi.mock('../../services/escalation');
vi.mock('../../services/user');
vi.mock('../../lib/events/publish', () => ({
  publishEscalationEvent: vi.fn(),
}));

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { resolveBySignalKey } from '../../api/escalations/resolve';

const mockGetBySignalKey = vi.mocked(escalationService.getEscalationBySignalKey);
const mockResolve = vi.mocked(escalationService.resolveEscalation);
const mockHasGlobalAccess = vi.mocked(userService.hasGlobalEscalationAccess);
const mockGetUserRoles = vi.mocked(userService.getUserRoles);

const AUTH = { userId: 'user-uuid' };

function makeEscalation(overrides: Record<string, any> = {}): any {
  return {
    id: 'esc-uuid',
    type: 'orderPipeline',
    subtype: 'qc',
    status: 'pending',
    role: 'operator',
    signal_key: 'station-done-wf-1',
    assigned_to: null,
    assigned_until: null,
    workflow_id: 'wf-1',
    workflow_type: 'efficientStation',
    task_queue: 'order-pipeline',
    metadata: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: global escalation access (webhook system account).
  mockHasGlobalAccess.mockResolvedValue(true);
  mockGetUserRoles.mockResolvedValue([]);
});

describe('resolveBySignalKey (api)', () => {
  it('rejects a missing signalKey with 400', async () => {
    const result = await resolveBySignalKey({ signalKey: '', resolverPayload: { approved: true } }, AUTH);
    expect(result.status).toBe(400);
    expect(mockGetBySignalKey).not.toHaveBeenCalled();
  });

  it('rejects a missing resolverPayload with 400', async () => {
    const result = await resolveBySignalKey({ signalKey: 'k', resolverPayload: undefined as any }, AUTH);
    expect(result.status).toBe(400);
  });

  it('returns 404 when the signal_key is unknown (fail-loud)', async () => {
    mockGetBySignalKey.mockResolvedValue(null);
    const result = await resolveBySignalKey({ signalKey: 'unknown', resolverPayload: { approved: true } }, AUTH);
    expect(result.status).toBe(404);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('returns 409 when the escalation is already terminal', async () => {
    mockGetBySignalKey.mockResolvedValue(makeEscalation({ status: 'resolved' }));
    const result = await resolveBySignalKey({ signalKey: 'k', resolverPayload: { approved: true } }, AUTH);
    expect(result.status).toBe(409);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('returns 404 when the caller cannot see the escalation role (RBAC)', async () => {
    mockHasGlobalAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([{ role: 'reviewer', type: 'member' } as any]);
    mockGetBySignalKey.mockResolvedValue(makeEscalation({ role: 'operator' }));
    const result = await resolveBySignalKey({ signalKey: 'k', resolverPayload: { approved: true } }, AUTH);
    expect(result.status).toBe(404);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('resolves and signals when pending and role-visible', async () => {
    const esc = makeEscalation();
    mockGetBySignalKey.mockResolvedValue(esc);
    mockResolve.mockResolvedValue(makeEscalation({ status: 'resolved' }));
    const result = await resolveBySignalKey({ signalKey: 'station-done-wf-1', resolverPayload: { approved: true } }, AUTH);
    expect(result.status).toBe(200);
    expect((result.data as any).signaled).toBe(true);
    expect((result.data as any).escalationId).toBe('esc-uuid');
    // No metadata patch → 3rd arg is undefined; still ONE atomic resolve call.
    expect(mockResolve).toHaveBeenCalledWith('esc-uuid', { approved: true }, undefined);
  });

  it('returns 409 when the atomic resolve loses the race (no double-resolve)', async () => {
    mockGetBySignalKey.mockResolvedValue(makeEscalation());
    // Another caller committed first — the guarded UPDATE returns null.
    mockResolve.mockResolvedValue(null);
    const result = await resolveBySignalKey({ signalKey: 'k', resolverPayload: { approved: true } }, AUTH);
    expect(result.status).toBe(409);
  });

  it('passes the outcome patch INTO the single atomic resolve (no separate write)', async () => {
    const esc = makeEscalation();
    mockGetBySignalKey.mockResolvedValue(esc);
    mockResolve.mockResolvedValue(makeEscalation({ status: 'resolved' }));
    const result = await resolveBySignalKey(
      { signalKey: 'station-done-wf-1', resolverPayload: { approved: true }, metadata: { outcome: 'approved', durationMs: 1200 } },
      AUTH,
    );
    expect(result.status).toBe(200);
    // The patch rides as the 3rd arg of resolve → merged in the same guarded UPDATE.
    // It is NEVER written via a separate, non-transactional metadata update
    // (no separate-write method exists on the service surface).
    expect(mockResolve).toHaveBeenCalledWith('esc-uuid', { approved: true }, { outcome: 'approved', durationMs: 1200 });
  });

  it('omits the patch (3rd arg undefined) when none is given — backward compatible', async () => {
    mockGetBySignalKey.mockResolvedValue(makeEscalation());
    mockResolve.mockResolvedValue(makeEscalation({ status: 'resolved' }));
    await resolveBySignalKey({ signalKey: 'station-done-wf-1', resolverPayload: { approved: true } }, AUTH);
    expect(mockResolve).toHaveBeenCalledWith('esc-uuid', { approved: true }, undefined);
  });
});
