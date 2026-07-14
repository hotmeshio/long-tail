import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import * as roleService from '../../../services/role';

// ─────────────────────────────────────────────────────────────────────────────
// Role LIST schema versioning
//
// A role's list_schema richly formats its escalation list page. It versions
// INDEPENDENTLY of the form/metadata pair: its own lt_role_list_schemas table
// and its own lt_roles.current_list_schema_version counter. Editing the list
// view must never advance the resolve form's version (and vice versa) — the two
// lineages are decoupled in the same atomic UPDATE_ROLE_METADATA statement.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE = `list-schema-ver-role-${Date.now()}`;

const LIST_V1 = { 'x-lt-layout': 'active-history', 'x-lt-active': { title: 'A' } };
const LIST_V2 = { 'x-lt-layout': 'active-history', 'x-lt-active': { title: 'B' } };
const FORM_V1 = { type: 'object', properties: { note: { type: 'string' } } };

describe('role service — list schema versioning', () => {
  beforeAll(async () => {
    await migrate();
    await roleService.createRole(ROLE);
  }, 30_000);

  afterAll(async () => {
    const { getPool } = await import('../../../lib/db');
    await getPool().query('DELETE FROM lt_roles WHERE role = $1', [ROLE]);
  });

  it('starts unversioned — no list schema, no version', async () => {
    const schema = await roleService.getRoleListSchema(ROLE);
    expect(schema).not.toBeNull();
    expect(schema!.version).toBeNull();
    expect(schema!.list_schema).toBeNull();
    expect(await roleService.listRoleListSchemaVersions(ROLE)).toEqual([]);
  });

  it('first list-schema write creates list version 1 with a snapshot', async () => {
    const updated = await roleService.updateRoleMetadata(ROLE, {
      list_schema: LIST_V1,
      change_summary: 'Initial list view',
    });
    expect(updated!.current_list_schema_version).toBe(1);

    const versions = await roleService.listRoleListSchemaVersions(ROLE);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].is_current).toBe(true);
    expect(versions[0].has_list_schema).toBe(true);
    expect(versions[0].change_summary).toBe('Initial list view');

    const snapshot = await roleService.getRoleListSchema(ROLE, 1);
    expect(snapshot!.list_schema).toEqual(LIST_V1);
  });

  it('changing the list schema bumps only the list version', async () => {
    const updated = await roleService.updateRoleMetadata(ROLE, {
      list_schema: LIST_V2,
      change_summary: 'Tweaked active card',
    });
    expect(updated!.current_list_schema_version).toBe(2);
    expect(updated!.current_schema_version).toBeNull(); // form lineage untouched

    const v2 = await roleService.getRoleListSchema(ROLE, 2);
    expect(v2!.list_schema).toEqual(LIST_V2);
    const v1 = await roleService.getRoleListSchema(ROLE, 1);
    expect(v1!.list_schema).toEqual(LIST_V1); // immutable
    expect(v1!.latest_version).toBe(2);
  });

  it('saving an identical list schema does not bump the version', async () => {
    const updated = await roleService.updateRoleMetadata(ROLE, { list_schema: LIST_V2 });
    expect(updated!.current_list_schema_version).toBe(2);
    expect(await roleService.listRoleListSchemaVersions(ROLE)).toHaveLength(2);
  });

  it('the form lineage and list lineage are independent', async () => {
    // A form-schema save bumps the form version but NOT the list version.
    const updated = await roleService.updateRoleMetadata(ROLE, {
      form_schema: FORM_V1,
      change_summary: 'First form',
    });
    expect(updated!.current_schema_version).toBe(1);
    expect(updated!.current_list_schema_version).toBe(2); // list held steady
    // The form-schema version history is separate from the list one.
    expect(await roleService.listRoleSchemaVersions(ROLE)).toHaveLength(1);
    expect(await roleService.listRoleListSchemaVersions(ROLE)).toHaveLength(2);
  });

  it('getRoleListSchema without a version returns the live (latest) schema', async () => {
    const latest = await roleService.getRoleListSchema(ROLE);
    expect(latest!.version).toBe(2);
    expect(latest!.latest_version).toBe(2);
    expect(latest!.list_schema).toEqual(LIST_V2);
  });

  it('a missing version returns null — never a silent fall-through to latest', async () => {
    expect(await roleService.getRoleListSchema(ROLE, 99)).toBeNull();
    expect(await roleService.getRoleListSchema('no-such-role')).toBeNull();
  });

  it('lists versions newest first with is_current on the head', async () => {
    const versions = await roleService.listRoleListSchemaVersions(ROLE);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0].is_current).toBe(true);
    expect(versions[1].is_current).toBe(false);
  });
});
