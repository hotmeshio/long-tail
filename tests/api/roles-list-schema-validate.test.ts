import { describe, it, expect, vi, beforeEach } from 'vitest';

// A list schema's related declaration is validated wherever the role is written.
vi.mock('../../services/role', () => ({
  updateRoleMetadata: vi.fn(),
  listDistinctRoles: vi.fn(async () => []),
  createRole: vi.fn(),
  getEscalationTargets: vi.fn(async () => []),
  replaceEscalationTargets: vi.fn(),
}));

import * as roleService from '../../services/role';
import { updateRole } from '../../api/roles';
import { applyRoleConfig } from '../../services/role/seed';

const update = vi.mocked(roleService.updateRoleMetadata);
const BAD = { 'x-lt-columns': [{ label: 'Holds', related: 'contents' }] };
const GOOD = {
  'x-lt-layout': 'facet-table',
  'x-lt-related': { contents: { source: 'items' } },
  'x-lt-columns': [{ label: 'Holds', related: 'contents' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue({ role: 'bin' } as any);
});

describe('list_schema related validation on write', () => {
  it('PATCH refuses an undeclared set with a 400, writing nothing', async () => {
    const result = await updateRole({ role: 'bin', list_schema: BAD });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/^list_schema: x-lt-columns\[0\]\.related must name a set/);
    expect(update).not.toHaveBeenCalled();
  });

  it('PATCH writes a valid declaration and a schema without the vocabulary', async () => {
    expect((await updateRole({ role: 'bin', list_schema: GOOD })).status).toBe(200);
    expect((await updateRole({ role: 'bin', list_schema: { 'x-lt-layout': 'active' } })).status).toBe(200);
    expect((await updateRole({ role: 'bin', list_schema: null })).status).toBe(200);
  });

  it('the startup apply throws before touching the role', async () => {
    await expect(applyRoleConfig({ role: 'bin', list_schema: BAD } as any, true))
      .rejects.toThrow(/role bin: list_schema: x-lt-columns\[0\]\.related/);
    expect(roleService.createRole).not.toHaveBeenCalled();
  });
});
