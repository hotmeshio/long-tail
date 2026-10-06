import { describe, it, expect, vi, beforeEach } from 'vitest';

// A role's station badge policy is validated where the role is written.
vi.mock('../../services/role', () => ({
  updateRoleMetadata: vi.fn(),
  listDistinctRoles: vi.fn(async () => []),
}));

import * as roleService from '../../services/role';
import { updateRole } from '../../api/roles';

const update = vi.mocked(roleService.updateRoleMetadata);

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue({ role: 'binning-associate' } as any);
});

describe('updateRole — properties.badge_grant', () => {
  it('ten minutes, unlimited, is written', async () => {
    const result = await updateRole({
      role: 'binning-associate',
      properties: { kiosk: true, badge_grant: { ttl_seconds: 600, max_uses: 0 } },
    });
    expect(result.status).toBe(200);
    expect(update.mock.calls[0][1].properties).toEqual({ kiosk: true, badge_grant: { ttl_seconds: 600, max_uses: 0 } });
  });

  it('an unusable policy is a 400 naming the field, and nothing is written', async () => {
    const result = await updateRole({ role: 'binning-associate', properties: { badge_grant: { ttl_seconds: 0 } } });
    expect(result).toEqual({ status: 400, error: 'properties.badge_grant.ttl_seconds must be an integer from 1 to 86400' });
    expect(update).not.toHaveBeenCalled();
  });

  it('a role without a policy is untouched by the check', async () => {
    expect((await updateRole({ role: 'gluer', properties: { kiosk: true } })).status).toBe(200);
  });
});
