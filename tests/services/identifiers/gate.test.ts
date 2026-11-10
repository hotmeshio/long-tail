import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../modules/capabilities', () => ({ mayManageRoles: vi.fn() }));
vi.mock('../../../services/user/roles', () => ({ hasRole: vi.fn() }));

import { mayManageRoles } from '../../../modules/capabilities';
import { hasRole } from '../../../services/user/roles';
import { mayBind } from '../../../services/identifiers/gate';

const USER = { userId: 'u-1' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(mayManageRoles).mockResolvedValue(false);
  vi.mocked(hasRole).mockResolvedValue(false);
});

describe('who may bind', () => {
  it('a role manager may bind under any scheme', async () => {
    vi.mocked(mayManageRoles).mockResolvedValue(true);
    expect(await mayBind(USER, { identifier: null })).toBe(true);
  });

  it('a holder of one of the scheme\'s binder roles may bind', async () => {
    vi.mocked(hasRole).mockImplementation(async (_u, role) => role === 'loader');
    expect(await mayBind(USER, { identifier: { binders: ['packer', 'loader'] } })).toBe(true);
  });

  it('anyone else may not, nor may a caller with no user', async () => {
    expect(await mayBind(USER, { identifier: { binders: ['loader'] } })).toBe(false);
    expect(await mayBind(USER, { identifier: null })).toBe(false);
    expect(await mayBind(undefined, { identifier: { binders: ['loader'] } })).toBe(false);
  });
});
