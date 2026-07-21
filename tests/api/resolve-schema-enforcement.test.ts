import { describe, it, expect, vi, beforeEach } from 'vitest';

// Enforcement gate END-TO-END at the API layer: real resolver-validation and
// real shared validation pass; only the role cache and DB-touching services
// are stubbed. Asserts both halves of the contract — violating payloads 422
// with the canonical body BEFORE any resolution side effect, and non-enforcing
// roles resolve exactly as before with zero schema reads.
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
import {
  resolveEscalation, resolveBySignalKey, resolveByIds, resolveAllOrNone,
} from '../../api/escalations/resolve';
import { LT_ERROR_CODES } from '../../types/validation';

const mockGet = vi.mocked(escalationService.getEscalation);
const mockGetBySignalKey = vi.mocked(escalationService.getEscalationBySignalKey);
const mockResolve = vi.mocked(escalationService.resolveEscalation);
const mockScopeRows = vi.mocked(escalationService.getEscalationScopeRows);
const mockGetByIds = vi.mocked(escalationService.getEscalationsByIds);
const mockResolveByIds = vi.mocked(escalationService.resolveEscalationsByIds);
const mockResolveAllOrNone = vi.mocked(escalationService.resolveEscalationsAllOrNone);

const AUTH = { userId: 'user-uuid' };
const SCHEMA = {
  required: ['status'],
  properties: { status: { type: 'string', enum: ['done', 'blocked'] } },
};

function makeEscalation(overrides: Record<string, any> = {}): any {
  return {
    id: 'esc-1',
    status: 'pending',
    role: 'station-a',
    workflow_id: null,
    workflow_type: null,
    task_queue: null,
    metadata: {},
    envelope: JSON.stringify({}),
    escalation_payload: null,
    assigned_to: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userService.hasGlobalEscalationAccess).mockResolvedValue(true);
  vi.mocked(userService.getUserRoles).mockResolvedValue([]);
  mockGetEnforcingRoles.mockResolvedValue(new Set(['station-a']));
  mockGetEnforcedFormSchema.mockResolvedValue(SCHEMA);
});

describe('by-id enforcement', () => {
  it('rejects a violating payload with the canonical 422 before resolving', async () => {
    mockGet.mockResolvedValue(makeEscalation());
    const result = await resolveEscalation({ id: 'esc-1', resolverPayload: { status: 'later' } }, AUTH);
    expect(result.status).toBe(422);
    expect(result.code).toBe(LT_ERROR_CODES.SCHEMA_VALIDATION);
    expect((result.data as any).violations).toEqual([
      { field: 'status', message: 'Must be one of: done, blocked' },
    ]);
    expect((result.data as any).role).toBe('station-a');
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('resolves a conforming payload (notification path)', async () => {
    mockGet.mockResolvedValue(makeEscalation());
    mockResolve.mockResolvedValue(makeEscalation({ status: 'resolved' }));
    const result = await resolveEscalation({ id: 'esc-1', resolverPayload: { status: 'done' } }, AUTH);
    expect(result.status).toBe(200);
  });

  it('leaves non-enforcing roles untouched — no schema read', async () => {
    mockGetEnforcingRoles.mockResolvedValue(new Set());
    mockGet.mockResolvedValue(makeEscalation());
    mockResolve.mockResolvedValue(makeEscalation({ status: 'resolved' }));
    const result = await resolveEscalation({ id: 'esc-1', resolverPayload: {} }, AUTH);
    expect(result.status).toBe(200);
    expect(mockGetEnforcedFormSchema).not.toHaveBeenCalled();
  });
});

describe('by-signal-key enforcement', () => {
  it('rejects a violating payload before the signal resolve', async () => {
    mockGetBySignalKey.mockResolvedValue(makeEscalation({ signal_key: 'sig-1' }));
    const result = await resolveBySignalKey({ signalKey: 'sig-1', resolverPayload: {} }, AUTH);
    expect(result.status).toBe(422);
    expect(result.code).toBe(LT_ERROR_CODES.SCHEMA_VALIDATION);
    expect(mockResolve).not.toHaveBeenCalled();
  });
});

describe('resolve-by-ids enforcement', () => {
  it('skips all row reads for a global caller when no role enforces', async () => {
    mockGetEnforcingRoles.mockResolvedValue(new Set());
    mockResolveByIds.mockResolvedValue([makeEscalation()]);
    const result = await resolveByIds({ ids: ['esc-1'], resolverPayload: {} }, AUTH);
    expect(result.status).toBe(200);
    expect(mockScopeRows).not.toHaveBeenCalled();
    expect(mockGetByIds).not.toHaveBeenCalled();
  });

  it('validates only enforcing rows and tags violations with escalationId', async () => {
    mockScopeRows.mockResolvedValue([
      { id: 'esc-1', role: 'station-a', assigned_to: null },
      { id: 'esc-2', role: 'other-role', assigned_to: null },
    ] as any);
    mockGetByIds.mockResolvedValue([makeEscalation({ id: 'esc-1' })]);
    const result = await resolveByIds({ ids: ['esc-1', 'esc-2'], resolverPayload: {} }, AUTH);
    expect(result.status).toBe(422);
    expect(mockGetByIds).toHaveBeenCalledWith(['esc-1']);
    expect((result.data as any).violations).toEqual([
      { field: 'status', message: 'Required', escalationId: 'esc-1' },
    ]);
    expect(mockResolveByIds).not.toHaveBeenCalled();
  });
});

describe('resolve-all-or-none enforcement', () => {
  it('blocks the whole batch when one item violates its row schema', async () => {
    mockGetByIds.mockResolvedValue([
      makeEscalation({ id: 'esc-1' }),
      makeEscalation({ id: 'esc-2' }),
    ]);
    const result = await resolveAllOrNone({
      items: [
        { id: 'esc-1', resolverPayload: { status: 'done' } },
        { id: 'esc-2', resolverPayload: { status: 'nope' } },
      ],
    }, AUTH);
    expect(result.status).toBe(422);
    expect((result.data as any).violations).toEqual([
      { field: 'status', message: 'Must be one of: done, blocked', escalationId: 'esc-2' },
    ]);
    expect(mockResolveAllOrNone).not.toHaveBeenCalled();
  });

  it('resolves when every item conforms', async () => {
    mockGetByIds.mockResolvedValue([makeEscalation({ id: 'esc-1' })]);
    mockResolveAllOrNone.mockResolvedValue({ ok: true, escalations: [makeEscalation({ id: 'esc-1' })] } as any);
    const result = await resolveAllOrNone({
      items: [{ id: 'esc-1', resolverPayload: { status: 'done' } }],
    }, AUTH);
    expect(result.status).toBe(200);
  });
});
