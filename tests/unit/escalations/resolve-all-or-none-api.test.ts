import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/escalation', () => ({
  getEscalationsByIds: vi.fn(),
  resolveEscalationsAllOrNone: vi.fn(),
}));

vi.mock('../../../api/escalations/helpers', () => ({
  assertReadAccess: vi.fn(),
  assertWriteAccess: vi.fn(),
  getEscalationWriteScope: vi.fn(),
}));

vi.mock('../../../workers', () => ({ createClient: vi.fn() }));
vi.mock('../../../services/task', () => ({ getTask: vi.fn() }));
vi.mock('../../../services/escalation-strategy', () => ({
  escalationStrategyRegistry: { current: null },
}));
vi.mock('../../../services/iam/ephemeral', () => ({
  storeEphemeral: vi.fn(async () => 'uuid-1'),
  formatEphemeralToken: vi.fn((id: string, key: string) => `eph:${id}:${key}`),
}));
vi.mock('../../../services/yaml-workflow/deployer', () => ({ getEngine: vi.fn() }));
vi.mock('../../../modules/defaults', () => ({
  JOB_EXPIRE_SECS: 3600,
  ESCALATION_BULK_RESOLVE_MAX: 100,
}));

import * as svc from '../../../services/escalation';
import { getEscalationWriteScope } from '../../../api/escalations/helpers';
import { resolveAllOrNone } from '../../../api/escalations/resolve';

const mockRows = vi.mocked(svc.getEscalationsByIds);
const mockResolve = vi.mocked(svc.resolveEscalationsAllOrNone);
const mockScope = vi.mocked(getEscalationWriteScope);

const AUTH = { userId: 'broker-1' };
const GLOBAL_SCOPE = { global: true, allRoles: [], selfRoles: [] } as any;

function makeRow(id: string, overrides: Record<string, any> = {}): any {
  return {
    id,
    status: 'pending',
    role: 'printer',
    assigned_to: null,
    signal_key: `sig-${id}`,
    metadata: {},
    ...overrides,
  };
}

function items(...ids: string[]) {
  return ids.map((id) => ({ id, resolverPayload: { unit: id } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockScope.mockResolvedValue(GLOBAL_SCOPE);
  mockResolve.mockResolvedValue({ ok: true, escalations: [] });
});

describe('resolveAllOrNone — input validation', () => {
  it('returns 400 for a missing or empty items array', async () => {
    expect((await resolveAllOrNone({ items: [] }, AUTH)).status).toBe(400);
    expect((await resolveAllOrNone({ items: null as any }, AUTH)).status).toBe(400);
  });

  it('returns 400 when items exceed the cap', async () => {
    const over = Array.from({ length: 101 }, (_, i) => ({ id: `e-${i}`, resolverPayload: {} }));
    const result = await resolveAllOrNone({ items: over }, AUTH);
    expect(result.status).toBe(400);
    expect(result.error).toContain('100');
  });

  it('returns 400 when an item lacks id or resolverPayload', async () => {
    const result = await resolveAllOrNone(
      { items: [{ id: 'e-1', resolverPayload: null as any }] },
      AUTH,
    );
    expect(result.status).toBe(400);
  });

  it('returns 400 for repeated ids', async () => {
    const result = await resolveAllOrNone({ items: items('e-1', 'e-1') }, AUTH);
    expect(result.status).toBe(400);
    expect(result.error).toContain('repeat');
  });
});

describe('resolveAllOrNone — RBAC', () => {
  it('returns 404 (non-disclosure) for a scoped caller when any id is missing', async () => {
    mockScope.mockResolvedValue({ global: false, allRoles: ['printer'], selfRoles: [] } as any);
    mockRows.mockResolvedValue([makeRow('e-1')]); // e-2 missing
    const result = await resolveAllOrNone({ items: items('e-1', 'e-2') }, AUTH);
    expect(result.status).toBe(404);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('returns 404 (non-disclosure) when any row is outside the caller scope', async () => {
    mockScope.mockResolvedValue({ global: false, allRoles: ['printer'], selfRoles: [] } as any);
    mockRows.mockResolvedValue([makeRow('e-1'), makeRow('e-2', { role: 'other-role' })]);
    const result = await resolveAllOrNone({ items: items('e-1', 'e-2') }, AUTH);
    expect(result.status).toBe(404);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('write_self scope authorizes only rows assigned to the caller', async () => {
    mockScope.mockResolvedValue({ global: false, allRoles: [], selfRoles: ['printer'] } as any);
    mockRows.mockResolvedValue([
      makeRow('e-1', { assigned_to: 'broker-1' }),
      makeRow('e-2', { assigned_to: 'someone-else' }),
    ]);
    const result = await resolveAllOrNone({ items: items('e-1', 'e-2') }, AUTH);
    expect(result.status).toBe(404);
    expect(mockResolve).not.toHaveBeenCalled();
  });
});

describe('resolveAllOrNone — path guard and delegation', () => {
  it('blocks rows that need the legacy single-resolve signal path', async () => {
    mockRows.mockResolvedValue([
      makeRow('e-1'),
      makeRow('e-2', { signal_key: null, metadata: { signal_id: 'sig-x' } }),
    ]);
    const result = await resolveAllOrNone({ items: items('e-1', 'e-2') }, AUTH);
    expect(result.status).toBe(409);
    expect(result.data?.failedIds).toEqual(['e-2']);
    expect(result.data?.failed).toEqual([{ id: 'e-2', reason: 'unsupported-resolution-path' }]);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('delegates per-row payloads to the service; no assignee assertion by default', async () => {
    mockRows.mockResolvedValue([makeRow('e-1'), makeRow('e-2')]);
    mockResolve.mockResolvedValue({
      ok: true,
      escalations: [{ id: 'e-1' }, { id: 'e-2' }] as any,
    });
    const result = await resolveAllOrNone({ items: items('e-1', 'e-2') }, AUTH);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ resolved: 2, escalationIds: ['e-1', 'e-2'] });
    expect(mockResolve).toHaveBeenCalledWith(
      [
        { id: 'e-1', resolverPayload: { unit: 'e-1' } },
        { id: 'e-2', resolverPayload: { unit: 'e-2' } },
      ],
      undefined,
      undefined,
    );
  });

  it('requireClaimed asserts the CALLER as assignee inside the statement', async () => {
    mockRows.mockResolvedValue([makeRow('e-1')]);
    mockResolve.mockResolvedValue({ ok: true, escalations: [{ id: 'e-1' }] as any });
    await resolveAllOrNone({ items: items('e-1'), requireClaimed: true }, AUTH);
    expect(mockResolve).toHaveBeenCalledWith(expect.anything(), undefined, 'broker-1');
  });

  it('maps a blocked batch to 409 with failedIds and reasons; error rides in the body', async () => {
    mockRows.mockResolvedValue([makeRow('e-1'), makeRow('e-2')]);
    mockResolve.mockResolvedValue({
      ok: false,
      failed: [{ id: 'e-2', reason: 'already-resolved' }],
    });
    const result = await resolveAllOrNone({ items: items('e-1', 'e-2') }, AUTH);
    expect(result.status).toBe(409);
    expect(result.error).toBeTruthy();
    expect(result.data?.error).toBe(result.error);
    expect(result.data?.failedIds).toEqual(['e-2']);
    expect(result.data?.failed).toEqual([{ id: 'e-2', reason: 'already-resolved' }]);
  });

  it('redacts password fields per row using that row\'s own form schema', async () => {
    mockRows.mockResolvedValue([
      makeRow('e-1', {
        metadata: { form_schema: { properties: { apiKey: { format: 'password' } } } },
      }),
      makeRow('e-2'), // no schema — payload passes through untouched
    ]);
    mockResolve.mockResolvedValue({ ok: true, escalations: [] });
    await resolveAllOrNone(
      {
        items: [
          { id: 'e-1', resolverPayload: { apiKey: 'plaintext-secret', unit: 'left' } },
          { id: 'e-2', resolverPayload: { apiKey: 'kept-as-is' } },
        ],
      },
      AUTH,
    );
    expect(mockResolve).toHaveBeenCalledWith(
      [
        { id: 'e-1', resolverPayload: { apiKey: 'eph:uuid-1:apiKey', unit: 'left' } },
        { id: 'e-2', resolverPayload: { apiKey: 'kept-as-is' } },
      ],
      undefined,
      undefined,
    );
  });
});
