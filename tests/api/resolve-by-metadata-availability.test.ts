import { describe, it, expect, vi, beforeEach } from 'vitest';

// Claim state and an asserted row ride both passes of the atomic resolve.
vi.mock('../../services/escalation');
vi.mock('../../services/user', async (importActual) => ({
  ...(await importActual<typeof import('../../services/user')>()),
  hasGlobalEscalationAccess: vi.fn().mockResolvedValue(true),
  getUserRoles: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../lib/events/publish', () => ({ publishEscalationEvent: vi.fn() }));
const mockGetEnforcingRoles = vi.fn();
const mockGetEnforcedFormSchema = vi.fn();
vi.mock('../../services/role/enforcement-cache', () => ({
  getEnforcingRoles: (...a: any[]) => mockGetEnforcingRoles(...a),
  getEnforcedFormSchema: (...a: any[]) => mockGetEnforcedFormSchema(...a),
}));

import * as escalationService from '../../services/escalation';
import { resolveByMetadata } from '../../api/escalations/metadata';

const mockAtomic = vi.mocked(escalationService.resolveByMetadataAtomic);
const AUTH = { userId: 'associate-1' };
const ID = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetEnforcingRoles.mockResolvedValue(new Set());
  mockAtomic.mockResolvedValue({ outcome: 'resolved', escalation: { id: ID } as any });
});

describe('resolveByMetadata claim state and asserted row', () => {
  it('passes availability and assertId to the statement', async () => {
    await resolveByMetadata({ key: 'binCode', value: 'S-1', resolverPayload: {}, availability: 'mine', assertId: ID }, AUTH);
    const args = mockAtomic.mock.calls[0];
    expect(args[8]).toBe(ID);
    expect(args[10]).toBe('mine');
  });

  it('keeps the claim state on the validated second pass', async () => {
    mockGetEnforcingRoles.mockResolvedValue(new Set(['binning-associate']));
    mockGetEnforcedFormSchema.mockResolvedValue(null);
    mockAtomic.mockResolvedValueOnce({
      outcome: 'validation_required', escalationId: ID,
      row: { id: ID, role: 'binning-associate', metadata: {}, envelope: '{}', escalation_payload: null },
    } as any);
    await resolveByMetadata({ key: 'binCode', value: 'S-1', resolverPayload: {}, availability: 'mine' }, AUTH);
    expect(mockAtomic).toHaveBeenCalledTimes(2);
    expect(mockAtomic.mock.calls[1][8]).toBe(ID);
    expect(mockAtomic.mock.calls[1][10]).toBe('mine');
  });

  it('a non-uuid asserted row is not found without touching SQL', async () => {
    const result = await resolveByMetadata({ key: 'binCode', value: 'S-1', resolverPayload: {}, assertId: 'nope' }, AUTH);
    expect(result.status).toBe(404);
    expect(mockAtomic).not.toHaveBeenCalled();
  });
});
