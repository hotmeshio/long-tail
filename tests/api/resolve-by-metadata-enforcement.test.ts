import { describe, it, expect, vi, beforeEach } from 'vitest';

// The by-metadata surface folds enforcement into the atomic statement: an
// enforcing target comes back 'validation_required' with NOTHING written, the
// payload validates here, and a second asserted pass claims + resolves the
// same row (pending re-checked in-statement). These tests pin the two-phase
// protocol and its failure modes.
vi.mock('../../services/escalation');
vi.mock('../../services/user', async (importActual) => {
  const actual = await importActual<typeof import('../../services/user')>();
  return {
    ...actual,
    hasGlobalEscalationAccess: vi.fn(),
    getUserRoles: vi.fn(),
    getUserByExternalId: vi.fn(),
  };
});
vi.mock('../../lib/events/publish', () => ({ publishEscalationEvent: vi.fn() }));

const mockGetEnforcingRoles = vi.fn();
const mockGetEnforcedFormSchema = vi.fn();
vi.mock('../../services/role/enforcement-cache', () => ({
  getEnforcingRoles: (...a: any[]) => mockGetEnforcingRoles(...a),
  getEnforcedFormSchema: (...a: any[]) => mockGetEnforcedFormSchema(...a),
}));

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { resolveByMetadata } from '../../api/escalations/metadata';
import { LT_ERROR_CODES } from '../../types/validation';

const mockAtomic = vi.mocked(escalationService.resolveByMetadataAtomic);

const AUTH = { userId: 'user-uuid' };
const SCHEMA = {
  required: ['status'],
  properties: { status: { type: 'string' } },
};
const ROW = {
  id: 'esc-1',
  role: 'station-a',
  metadata: {},
  envelope: JSON.stringify({}),
  escalation_payload: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userService.hasGlobalEscalationAccess).mockResolvedValue(true);
  vi.mocked(userService.getUserRoles).mockResolvedValue([]);
  mockGetEnforcingRoles.mockResolvedValue(new Set(['station-a']));
  mockGetEnforcedFormSchema.mockResolvedValue(SCHEMA);
});

describe('resolve-by-metadata enforcement', () => {
  it('passes the enforcing set into the atomic statement', async () => {
    mockAtomic.mockResolvedValue({ outcome: 'not_found' });
    await resolveByMetadata({ key: 'orderId', value: 'o-1', resolverPayload: { status: 'done' } }, AUTH);
    expect(mockAtomic).toHaveBeenCalledTimes(1);
    expect(mockAtomic.mock.calls[0][6]).toBeNull(); // global caller: writeSelfRoles null
    expect(mockAtomic.mock.calls[0][7]).toEqual(['station-a']);
  });

  it('omits the enforcing set (single-call path) when no role enforces', async () => {
    mockGetEnforcingRoles.mockResolvedValue(new Set());
    mockAtomic.mockResolvedValue({ outcome: 'not_found' });
    await resolveByMetadata({ key: 'orderId', value: 'o-1', resolverPayload: {} }, AUTH);
    expect(mockAtomic).toHaveBeenCalledTimes(1);
    expect(mockAtomic.mock.calls[0][7]).toBeNull();
  });

  it('rejects a violating payload with 422 and never re-invokes', async () => {
    mockAtomic.mockResolvedValue({ outcome: 'validation_required', escalationId: 'esc-1', row: ROW });
    const result = await resolveByMetadata(
      { key: 'orderId', value: 'o-1', resolverPayload: {} }, AUTH,
    );
    expect(result.status).toBe(422);
    expect(result.code).toBe(LT_ERROR_CODES.SCHEMA_VALIDATION);
    expect((result.data as any).violations).toEqual([{ field: 'status', message: 'Required' }]);
    expect(mockAtomic).toHaveBeenCalledTimes(1);
  });

  it('re-invokes with the asserted row id after a passing validation', async () => {
    mockAtomic
      .mockResolvedValueOnce({ outcome: 'validation_required', escalationId: 'esc-1', row: ROW })
      .mockResolvedValueOnce({ outcome: 'resolved', escalation: { id: 'esc-1' } as any });
    const result = await resolveByMetadata(
      { key: 'orderId', value: 'o-1', resolverPayload: { status: 'done' } }, AUTH,
    );
    expect(result.status).toBe(200);
    expect(mockAtomic).toHaveBeenCalledTimes(2);
    // Second pass: enforcement off, row asserted.
    expect(mockAtomic.mock.calls[1][7]).toBeNull();
    expect(mockAtomic.mock.calls[1][8]).toBe('esc-1');
  });

  it('surfaces a lost race as 409 when the asserted row left pending', async () => {
    mockAtomic
      .mockResolvedValueOnce({ outcome: 'validation_required', escalationId: 'esc-1', row: ROW })
      .mockResolvedValueOnce({ outcome: 'not_found' });
    const result = await resolveByMetadata(
      { key: 'orderId', value: 'o-1', resolverPayload: { status: 'done' } }, AUTH,
    );
    expect(result.status).toBe(409);
  });
});
