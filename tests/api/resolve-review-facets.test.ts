import { describe, it, expect, vi, beforeEach } from 'vitest';

// Review facets ride the outcome patch into the guarded resolve UPDATE on
// every single-row path; the server's values win over a caller's.
vi.mock('../../services/escalation');
vi.mock('../../services/user');
vi.mock('../../services/task');
vi.mock('../../services/escalation-strategy', () => ({
  escalationStrategyRegistry: { current: null },
}));
vi.mock('../../services/yaml-workflow/deployer', () => ({ getEngine: vi.fn() }));
vi.mock('../../lib/events/publish', () => ({ publishEscalationEvent: vi.fn() }));
vi.mock('../../services/iam/ephemeral', () => ({
  storeEphemeral: vi.fn(async () => 'eph-uuid-1'),
  formatEphemeralToken: (uuid: string, label: string) => `eph:v1:${label}:${uuid}`,
}));
vi.mock('../../workers', () => ({
  createClient: () => ({
    workflow: { getHandle: vi.fn(async () => ({ signal: vi.fn() })), start: vi.fn() },
  }),
}));

const mockGetEnforcingRoles = vi.fn();
const mockGetEnforcedFormSchema = vi.fn();
vi.mock('../../services/role/enforcement-cache', () => ({
  getEnforcingRoles: (...a: any[]) => mockGetEnforcingRoles(...a),
  getEnforcedFormSchema: (...a: any[]) => mockGetEnforcedFormSchema(...a),
}));

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { resolveEscalation, resolveBySignalKey } from '../../api/escalations/resolve';

const mockGet = vi.mocked(escalationService.getEscalation);
const mockGetBySignalKey = vi.mocked(escalationService.getEscalationBySignalKey);
const mockResolve = vi.mocked(escalationService.resolveEscalation);

const AUTH = { userId: 'user-uuid' };
const SCHEMA = {
  'x-lt-confidence': { tranches: [{ below: 0.6, label: 'Low', tone: 'error' }], facets: true },
  properties: { first_name: { type: 'string' }, city: { type: 'string' } },
};
const ENVELOPE = {
  formDefaults: { first_name: 'Jon', city: 'Portland' },
  confidence: { first_name: 0.52, city: 0.95 },
};

function makeEscalation(overrides: Record<string, any> = {}): any {
  return {
    id: 'esc-1', status: 'pending', role: 'intake', workflow_id: null, workflow_type: null,
    task_queue: null, metadata: {}, envelope: JSON.stringify(ENVELOPE), escalation_payload: null,
    assigned_to: null, ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userService.hasGlobalEscalationAccess).mockResolvedValue(true);
  vi.mocked(userService.getUserRoles).mockResolvedValue([]);
  mockGetEnforcingRoles.mockResolvedValue(new Set(['intake']));
  mockGetEnforcedFormSchema.mockResolvedValue(SCHEMA);
});

describe('review facets on resolve', () => {
  it('merges the summary into the by-id outcome, over caller metadata', async () => {
    mockGet.mockResolvedValue(makeEscalation());
    mockResolve.mockResolvedValue(makeEscalation({ status: 'resolved' }));
    const result = await resolveEscalation({
      id: 'esc-1',
      resolverPayload: { first_name: 'John', city: 'Portland' },
      metadata: { review_outcome: 'accepted', note: 'kept' },
    }, AUTH);
    expect(result.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith('esc-1', expect.anything(), {
      note: 'kept',
      review_outcome: 'corrected',
      review_changed: '1',
      review_worst: 'Low',
      resolved_by: 'user-uuid',
    }, 'user-uuid');
  });

  it('merges the summary into the signal-key outcome', async () => {
    mockGetBySignalKey.mockResolvedValue(makeEscalation({ signal_key: 'sig-1', workflow_id: 'wf-1' }));
    mockResolve.mockResolvedValue(makeEscalation({ status: 'resolved' }));
    await resolveBySignalKey({ signalKey: 'sig-1', resolverPayload: { first_name: 'Jon', city: 'Portland' } }, AUTH);
    expect(mockResolve.mock.calls[0][2]).toMatchObject({
      review_outcome: 'accepted', review_changed: '0', review_worst: 'Low', resolved_by: 'user-uuid',
    });
  });

  it('adds nothing when the role does not enforce its schema', async () => {
    mockGetEnforcingRoles.mockResolvedValue(new Set());
    mockGet.mockResolvedValue(makeEscalation());
    mockResolve.mockResolvedValue(makeEscalation({ status: 'resolved' }));
    await resolveEscalation({ id: 'esc-1', resolverPayload: { first_name: 'John' } }, AUTH);
    expect(mockResolve.mock.calls[0][2]).toEqual({ resolved_by: 'user-uuid' });
  });
});
