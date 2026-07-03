import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import * as roleService from '../../../services/role';

// ─────────────────────────────────────────────────────────────────────────────
// Role schema versioning
//
// Every updateRoleMetadata call that CHANGES form_schema or metadata_schema
// appends an immutable (role, version) snapshot to lt_role_schemas and
// advances lt_roles.current_schema_version — in the same atomic statement.
// The contract (docs/api/http/roles.md, docs/hitl-guide.md):
//
//   - first schema write → version 1
//   - each subsequent schema change → version + 1, snapshot of the pair
//   - a save with identical schema values does NOT bump the version
//   - a non-schema update (title, sla) does NOT bump the version
//   - getRoleSchema(role) reads the live/latest pair; (role, version) reads
//     the immutable snapshot; a missing version returns null (never latest)
// ─────────────────────────────────────────────────────────────────────────────

const ROLE = `schema-ver-role-${Date.now()}`;

const FORM_V1 = { type: 'object', properties: { note: { type: 'string' } } };
const META_V1 = { type: 'object', properties: { order_id: { type: 'string' } } };
const FORM_V2 = {
  type: 'object',
  properties: { note: { type: 'string' }, lotNumber: { type: 'string' } },
};

describe('role service — schema versioning', () => {
  beforeAll(async () => {
    await migrate();
    await roleService.createRole(ROLE);
  }, 30_000);

  afterAll(async () => {
    const { getPool } = await import('../../../lib/db');
    // lt_role_schemas rows cascade with the role.
    await getPool().query('DELETE FROM lt_roles WHERE role = $1', [ROLE]);
  });

  it('starts unversioned — no schema, no version', async () => {
    const schema = await roleService.getRoleSchema(ROLE);
    expect(schema).not.toBeNull();
    expect(schema!.version).toBeNull();
    expect(schema!.form_schema).toBeNull();
    const versions = await roleService.listRoleSchemaVersions(ROLE);
    expect(versions).toEqual([]);
  });

  it('first schema write creates version 1 with a snapshot', async () => {
    const updated = await roleService.updateRoleMetadata(ROLE, {
      form_schema: FORM_V1,
      metadata_schema: META_V1,
      change_summary: 'Initial schema',
    });
    expect(updated!.current_schema_version).toBe(1);

    const versions = await roleService.listRoleSchemaVersions(ROLE);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].is_current).toBe(true);
    expect(versions[0].change_summary).toBe('Initial schema');

    const snapshot = await roleService.getRoleSchema(ROLE, 1);
    expect(snapshot!.form_schema).toEqual(FORM_V1);
    expect(snapshot!.metadata_schema).toEqual(META_V1);
  });

  it('changing one schema field bumps the version and snapshots the full pair', async () => {
    const updated = await roleService.updateRoleMetadata(ROLE, {
      form_schema: FORM_V2,
      change_summary: 'Added lotNumber field',
    });
    expect(updated!.current_schema_version).toBe(2);

    // The v2 snapshot carries the new form AND the carried-over metadata schema.
    const v2 = await roleService.getRoleSchema(ROLE, 2);
    expect(v2!.form_schema).toEqual(FORM_V2);
    expect(v2!.metadata_schema).toEqual(META_V1);

    // v1 is immutable — still the original pair.
    const v1 = await roleService.getRoleSchema(ROLE, 1);
    expect(v1!.form_schema).toEqual(FORM_V1);
    expect(v1!.latest_version).toBe(2);
  });

  it('saving identical schema values does not bump the version', async () => {
    const updated = await roleService.updateRoleMetadata(ROLE, {
      form_schema: FORM_V2,
      metadata_schema: META_V1,
    });
    expect(updated!.current_schema_version).toBe(2);
    const versions = await roleService.listRoleSchemaVersions(ROLE);
    expect(versions).toHaveLength(2);
  });

  it('a non-schema update does not bump the version', async () => {
    const updated = await roleService.updateRoleMetadata(ROLE, {
      title: 'Renamed',
      sla_minutes: 45,
    });
    expect(updated!.current_schema_version).toBe(2);
    expect(await roleService.listRoleSchemaVersions(ROLE)).toHaveLength(2);
  });

  it('getRoleSchema without a version returns the live (latest) pair', async () => {
    const latest = await roleService.getRoleSchema(ROLE);
    expect(latest!.version).toBe(2);
    expect(latest!.latest_version).toBe(2);
    expect(latest!.form_schema).toEqual(FORM_V2);
  });

  it('a missing version returns null — never a silent fall-through to latest', async () => {
    expect(await roleService.getRoleSchema(ROLE, 99)).toBeNull();
    expect(await roleService.getRoleSchema('no-such-role')).toBeNull();
  });

  it('lists versions newest first with is_current on the head', async () => {
    const versions = await roleService.listRoleSchemaVersions(ROLE);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0].is_current).toBe(true);
    expect(versions[1].is_current).toBe(false);
  });
});
