import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import * as roleService from '../../../services/role';
import * as rolesApi from '../../../api/roles';

// ─────────────────────────────────────────────────────────────────────────────
// Upstream inputs (lt_role_upstreams)
//
// parent_role places a role in one Operations sequence; upstream_roles are the
// remaining graph edges — roles it draws input from across other sequences.
// Contract (docs/api/http/roles.md):
//
//   - upstream_roles replaces the SET in the same atomic UPDATE (omitted =
//     preserve, null or [] = clear); survivors are kept, not delete+reinserted
//   - self-reference and unknown roles are rejected at the API layer (400)
// ─────────────────────────────────────────────────────────────────────────────

const STAMP = Date.now();
const SHIPPING = `ups-shipping-${STAMP}`;
const ORDERING = `ups-ordering-${STAMP}`;
const INSERTING = `ups-inserting-${STAMP}`;

describe('role service — upstream inputs replace semantics', () => {
  beforeAll(async () => {
    await migrate();
    await roleService.createRole(SHIPPING);
    await roleService.createRole(ORDERING);
    await roleService.createRole(INSERTING);
  }, 30_000);

  afterAll(async () => {
    const { getPool } = await import('../../../lib/db');
    // lt_role_upstreams rows cascade with the roles.
    await getPool().query('DELETE FROM lt_roles WHERE role = ANY($1)', [[SHIPPING, ORDERING, INSERTING]]);
  });

  it('starts empty', async () => {
    expect(await roleService.getRoleUpstreams(SHIPPING)).toEqual([]);
  });

  it('sets the upstream set and returns it on the updated row', async () => {
    const updated = await roleService.updateRoleMetadata(SHIPPING, {
      upstream_roles: [INSERTING, ORDERING],
    });
    expect(updated!.upstream_roles).toEqual([INSERTING, ORDERING].sort());
    expect(await roleService.getRoleUpstreams(SHIPPING)).toEqual([INSERTING, ORDERING].sort());
  });

  it('omitting the field preserves the set (and reads it back on the result)', async () => {
    const updated = await roleService.updateRoleMetadata(SHIPPING, { title: 'Shipping' });
    expect(updated!.upstream_roles).toEqual([INSERTING, ORDERING].sort());
  });

  it('replaces the set — survivors kept, leavers pruned, newcomers added', async () => {
    const updated = await roleService.updateRoleMetadata(SHIPPING, {
      upstream_roles: [INSERTING],
    });
    expect(updated!.upstream_roles).toEqual([INSERTING]);
    expect(await roleService.getRoleUpstreams(SHIPPING)).toEqual([INSERTING]);
  });

  it('null clears the set', async () => {
    const updated = await roleService.updateRoleMetadata(SHIPPING, { upstream_roles: null });
    expect(updated!.upstream_roles).toEqual([]);
  });

  it('appears in listRolesWithDetails aggregation', async () => {
    await roleService.updateRoleMetadata(SHIPPING, { upstream_roles: [ORDERING] });
    const roles = await roleService.listRolesWithDetails();
    const shipping = roles.find((r) => r.role === SHIPPING);
    expect(shipping!.upstream_roles).toEqual([ORDERING]);
    const ordering = roles.find((r) => r.role === ORDERING);
    expect(ordering!.upstream_roles).toEqual([]);
  });

  it('API rejects a self-reference with 400', async () => {
    const result = await rolesApi.updateRole({ role: SHIPPING, upstream_roles: [SHIPPING] });
    expect(result.status).toBe(400);
    expect(result.error).toContain('itself');
  });

  it('API rejects unknown roles with 400 — never a silent partial write', async () => {
    const result = await rolesApi.updateRole({
      role: SHIPPING,
      upstream_roles: [ORDERING, 'no-such-role'],
    });
    expect(result.status).toBe(400);
    expect(result.error).toContain('no-such-role');
    // The prior set is untouched.
    expect(await roleService.getRoleUpstreams(SHIPPING)).toEqual([ORDERING]);
  });

  it('API rejects a non-array with 400', async () => {
    const result = await rolesApi.updateRole({
      role: SHIPPING,
      upstream_roles: 'ordering' as unknown as string[],
    });
    expect(result.status).toBe(400);
  });
});
