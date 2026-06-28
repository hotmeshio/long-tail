import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies — fast, no Postgres.
vi.mock('../../services/escalation');
vi.mock('../../services/user');
vi.mock('../../services/task');
vi.mock('../../services/escalation-strategy', () => ({
  escalationStrategyRegistry: { current: null },
}));
vi.mock('../../services/yaml-workflow/deployer', () => ({ getEngine: vi.fn() }));
vi.mock('../../lib/events/publish', () => ({ publishEscalationEvent: vi.fn() }));

// Ephemeral redaction: deterministic token so we can assert the RAW password
// never reaches the persisted resolve.
vi.mock('../../services/iam/ephemeral', () => ({
  storeEphemeral: vi.fn(async () => 'eph-uuid-1'),
  formatEphemeralToken: (uuid: string, label: string) => `eph:v1:${label}:${uuid}`,
}));

const mockSignal = vi.fn();
vi.mock('../../workers', () => ({
  createClient: () => ({
    workflow: { getHandle: vi.fn(async () => ({ signal: mockSignal })) },
  }),
}));

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { resolveEscalation } from '../../api/escalations/resolve';

const mockGet = vi.mocked(escalationService.getEscalation);
const mockResolve = vi.mocked(escalationService.resolveEscalation);
const mockHasGlobalAccess = vi.mocked(userService.hasGlobalEscalationAccess);
const mockGetUserRoles = vi.mocked(userService.getUserRoles);

const AUTH = { userId: 'user-uuid' };

function makeEscalation(overrides: Record<string, any> = {}): any {
  return {
    id: 'esc-uuid',
    status: 'pending',
    role: 'operator',
    workflow_id: 'wf-1',
    workflow_type: 'orderPipeline',
    task_queue: 'order-pipeline',
    metadata: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasGlobalAccess.mockResolvedValue(true);
  mockGetUserRoles.mockResolvedValue([]);
});

describe('resolveEscalation (by-id) — RBAC parity', () => {
  it('returns 404 (not 403) when the caller cannot see the escalation role', async () => {
    mockHasGlobalAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([{ role: 'reviewer', type: 'member' } as any]);
    mockGet.mockResolvedValue(makeEscalation({ role: 'operator' }));

    const result = await resolveEscalation({ id: 'esc-uuid', resolverPayload: { approved: true } }, AUTH);

    expect(result.status).toBe(404);
    // No mutation when out of scope — the by-id path now matches resolveBySignalKey.
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('proceeds for a global-access caller (no role filter)', async () => {
    // Notification-only escalation (Path D) → one atomic resolve, easy to assert.
    mockGet.mockResolvedValue(makeEscalation({ workflow_type: null, task_queue: null }));
    mockResolve.mockResolvedValue(makeEscalation({ status: 'resolved' }));

    const result = await resolveEscalation({ id: 'esc-uuid', resolverPayload: { approved: true } }, AUTH);

    expect(result.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith('esc-uuid', { approved: true }, undefined);
  });
});

describe('resolveEscalation (by-id) — Path B signal routing', () => {
  it('persists the REDACTED payload, never the raw password (no plaintext in resolver_payload)', async () => {
    mockGet.mockResolvedValue(
      makeEscalation({
        metadata: {
          form_schema: { properties: { secret: { format: 'password' } } },
          signal_routing: {
            signalId: 'sig-1',
            workflowId: 'wf-routed',
            taskQueue: 'q',
            workflowType: 't',
            engine: 'durable',
          },
        },
      }),
    );
    mockResolve.mockResolvedValue(makeEscalation({ status: 'resolved' }));

    const result = await resolveEscalation(
      { id: 'esc-uuid', resolverPayload: { approved: true, secret: 'hunter2' } },
      AUTH,
    );

    expect(result.status).toBe(200);
    // The signal carries the redacted token, and the SAME redacted payload is
    // persisted — the raw 'hunter2' must never appear in either.
    const signalArg = mockSignal.mock.calls[0][1];
    expect(signalArg.secret).toBe('eph:v1:secret:eph-uuid-1');
    const [, persisted] = mockResolve.mock.calls[0];
    expect(persisted.secret).toBe('eph:v1:secret:eph-uuid-1');
    expect(JSON.stringify(mockResolve.mock.calls[0])).not.toContain('hunter2');
  });
});
