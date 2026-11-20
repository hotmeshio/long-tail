import { describe, it, expect, vi, beforeEach } from 'vitest';

// A form schema's list tokens are validated wherever the role is written.
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
const BAD = { properties: { lines: { type: 'array', 'x-lt-widget': 'rows', items: { type: 'string' } } } };
const GOOD = {
  properties: {
    lines: { type: 'array', 'x-lt-widget': 'rows', items: { type: 'object', properties: { code: { type: 'string' } } } },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue({ role: 'review' } as any);
});

describe('form_schema list token validation on write', () => {
  it('PATCH refuses a malformed list token with a 400, writing nothing', async () => {
    const result = await updateRole({ role: 'review', form_schema: BAD });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/^form_schema: lines: x-lt-widget "rows" needs items of type object/);
    expect(update).not.toHaveBeenCalled();
  });

  it('PATCH writes a sound schema and a clear', async () => {
    expect((await updateRole({ role: 'review', form_schema: GOOD })).status).toBe(200);
    expect((await updateRole({ role: 'review', form_schema: null })).status).toBe(200);
  });

  it('the startup apply throws before touching the role', async () => {
    await expect(applyRoleConfig({ role: 'review', form_schema: BAD } as any, true))
      .rejects.toThrow(/role review: form_schema: lines: x-lt-widget "rows"/);
    expect(roleService.createRole).not.toHaveBeenCalled();
  });
});
