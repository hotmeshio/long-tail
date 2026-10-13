import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/escalation');
vi.mock('../../services/user', async (importActual) => ({
  ...(await importActual<typeof import('../../services/user')>()),
  hasGlobalEscalationAccess: vi.fn(async () => true),
  getUserRoles: vi.fn(async () => []),
}));

import * as escalationService from '../../services/escalation';
import { claimByMetadata } from '../../api/escalations/metadata';

const asserted = vi.mocked(escalationService.claimAssertedByMetadata);
const byCode = vi.mocked(escalationService.claimByMetadata);
const AUTH = { userId: 'system-uuid' };
const ID = '44444444-4444-4444-8444-444444444444';

beforeEach(() => vi.clearAllMocks());

// assertId pins the claim to one row; without it the claim picks by code.
describe('claimByMetadata with assertId', () => {
  it('claims only the named row', async () => {
    asserted.mockResolvedValue({ escalation: { id: ID } as any, isExtension: false });
    const result = await claimByMetadata({ key: 'binCode', value: 'S-1', assertId: ID, metadata: { a: 1 } }, AUTH);
    expect(result).toEqual({ status: 200, data: { escalation: { id: ID }, isExtension: false } });
    expect(asserted).toHaveBeenCalledWith(ID, 'binCode', 'S-1', 'system-uuid', undefined, { a: 1 }, null);
    expect(byCode).not.toHaveBeenCalled();
  });

  it('is 404 when the named row no longer qualifies', async () => {
    asserted.mockResolvedValue(null);
    const result = await claimByMetadata({ key: 'binCode', value: 'S-1', assertId: ID }, AUTH);
    expect(result.status).toBe(404);
  });

  it('is 404 for a non-uuid id, before any SQL', async () => {
    const result = await claimByMetadata({ key: 'binCode', value: 'S-1', assertId: 'row-1' }, AUTH);
    expect(result.status).toBe(404);
    expect(asserted).not.toHaveBeenCalled();
  });
});
