import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import * as roleService from '../../../services/role';

// ─────────────────────────────────────────────────────────────────────────────
// Role update — PATCH semantics
//
// updateRoleMetadata is the single write path for role definitions (HTTP
// PATCH /api/roles/:role, MCP update_role, dashboard role editor, example
// seeders). The contract, stated in docs/api/http/roles.md and the JSDoc:
//
//   - a field omitted from the input keeps its current value
//   - a field explicitly set to null is cleared
//   - properties set to null resets to {}
//
// The dashboard depends on this: the schema editor sends { role, form_schema }
// alone, and the details form sends only its own fields. A full-overwrite
// implementation silently destroys every other column on each save.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE = `upd-role-${Date.now()}`;

describe('role service — updateRoleMetadata PATCH semantics', () => {
  beforeAll(async () => {
    await migrate();
    await roleService.createRole(ROLE);
    // Establish a fully-populated baseline.
    await roleService.updateRoleMetadata(ROLE, {
      title: 'Station Title',
      description: 'Station description',
      form_schema: { type: 'object', properties: { note: { type: 'string' } } },
      metadata_schema: { type: 'object', properties: { order_id: { type: 'string' } } },
      properties: { color: 'blue' },
      ops_visible: true,
      sla_minutes: 30,
      target_per_hour: 22,
      worker_count: 3,
    });
  }, 30_000);

  afterAll(async () => {
    const { getPool } = await import('../../../lib/db');
    await getPool().query('DELETE FROM lt_roles WHERE role = $1', [ROLE]);
  });

  it('updates only the provided field and preserves every omitted field', async () => {
    const updated = await roleService.updateRoleMetadata(ROLE, {
      title: 'Renamed Station',
    });
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe('Renamed Station');
    expect(updated!.description).toBe('Station description');
    expect(updated!.form_schema).toEqual({
      type: 'object',
      properties: { note: { type: 'string' } },
    });
    expect(updated!.metadata_schema).toEqual({
      type: 'object',
      properties: { order_id: { type: 'string' } },
    });
    expect(updated!.properties).toEqual({ color: 'blue' });
    expect(updated!.ops_visible).toBe(true);
    expect(Number(updated!.sla_minutes)).toBe(30);
    expect(Number(updated!.target_per_hour)).toBe(22);
    expect(Number(updated!.worker_count)).toBe(3);
  });

  it('a schema-only save (the dashboard schema editor payload) preserves the ops fields', async () => {
    const updated = await roleService.updateRoleMetadata(ROLE, {
      form_schema: { type: 'object', properties: { qty: { type: 'number' } } },
    });
    expect(updated!.form_schema).toEqual({
      type: 'object',
      properties: { qty: { type: 'number' } },
    });
    expect(updated!.title).toBe('Renamed Station');
    expect(updated!.ops_visible).toBe(true);
    expect(Number(updated!.sla_minutes)).toBe(30);
    expect(Number(updated!.target_per_hour)).toBe(22);
    expect(Number(updated!.worker_count)).toBe(3);
  });

  it('explicit null clears a clearable field, leaving siblings intact', async () => {
    const updated = await roleService.updateRoleMetadata(ROLE, {
      metadata_schema: null,
      sla_minutes: null,
    });
    expect(updated!.metadata_schema).toBeNull();
    expect(updated!.sla_minutes).toBeNull();
    expect(updated!.form_schema).toEqual({
      type: 'object',
      properties: { qty: { type: 'number' } },
    });
    expect(Number(updated!.target_per_hour)).toBe(22);
  });

  it('properties: provided replaces, null resets to {}, omitted preserves', async () => {
    await roleService.updateRoleMetadata(ROLE, { properties: { color: 'red', tag: 'a' } });
    let detail = await roleService.updateRoleMetadata(ROLE, { title: 'Renamed Again' });
    expect(detail!.properties).toEqual({ color: 'red', tag: 'a' });

    detail = await roleService.updateRoleMetadata(ROLE, { properties: null });
    expect(detail!.properties).toEqual({});
  });

  it('ops_visible: false is a real update, omitted is preserved', async () => {
    let detail = await roleService.updateRoleMetadata(ROLE, { ops_visible: false });
    expect(detail!.ops_visible).toBe(false);
    detail = await roleService.updateRoleMetadata(ROLE, { description: 'still here' });
    expect(detail!.ops_visible).toBe(false);
    detail = await roleService.updateRoleMetadata(ROLE, { ops_visible: true });
    expect(detail!.ops_visible).toBe(true);
  });

  it('returns null for an unknown role', async () => {
    const detail = await roleService.updateRoleMetadata('no-such-role-ever', {
      title: 'x',
    });
    expect(detail).toBeNull();
  });

  it('priority dials: set, preserved on unrelated saves, cleared by explicit null', async () => {
    let detail = await roleService.updateRoleMetadata(ROLE, {
      priority_threshold_minutes: 240,
      priority_facet: 'authorized_at',
    });
    expect(Number(detail!.priority_threshold_minutes)).toBe(240);
    expect(detail!.priority_facet).toBe('authorized_at');

    detail = await roleService.updateRoleMetadata(ROLE, { title: 'Unrelated Save' });
    expect(Number(detail!.priority_threshold_minutes)).toBe(240);
    expect(detail!.priority_facet).toBe('authorized_at');

    detail = await roleService.updateRoleMetadata(ROLE, {
      priority_threshold_minutes: null,
      priority_facet: null,
    });
    expect(detail!.priority_threshold_minutes).toBeNull();
    expect(detail!.priority_facet).toBeNull();
  });
});

describe('role service — createRole reports creation', () => {
  const FRESH = `create-role-${Date.now()}`;

  afterAll(async () => {
    const { getPool } = await import('../../../lib/db');
    await getPool().query('DELETE FROM lt_roles WHERE role = $1', [FRESH]);
  });

  it('returns true on first creation and false when the role already exists', async () => {
    expect(await roleService.createRole(FRESH)).toBe(true);
    expect(await roleService.createRole(FRESH)).toBe(false);
  });
});
