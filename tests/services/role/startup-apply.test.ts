import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import * as roleService from '../../../services/role';
import { applyRoleConfig, STARTUP_CHANGE_SUMMARY } from '../../../services/role/seed';

// ─────────────────────────────────────────────────────────────────────────────
// Startup role apply — code-owned declarations register through the versioned
// PATCH path: an unchanged declaration is a no-op, a changed schema advances
// the version and snapshots it, and a db-owned role belongs to the DB after
// its one-time metadata write.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE = `apply-role-${Date.now()}`;
const TARGET = `${ROLE}-target`;
const DB_ROLE = `${ROLE}-db-owned`;

const FORM_V1 = { type: 'object', properties: { note: { type: 'string' } } };
const FORM_V2 = { type: 'object', properties: { note: { type: 'string' }, qty: { type: 'number' } } };

describe('role service — startup apply (code-owned)', () => {
  beforeAll(async () => {
    await migrate();
  }, 30_000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM lt_config_role_escalations WHERE source_role = ANY($1)', [[ROLE, DB_ROLE]]);
    await pool.query('DELETE FROM lt_role_schemas WHERE role = ANY($1)', [[ROLE, DB_ROLE]]);
    await pool.query('DELETE FROM lt_roles WHERE role = ANY($1)', [[ROLE, TARGET, DB_ROLE]]);
  });

  it('registers a new role with versioned schema and escalation targets', async () => {
    const outcome = await applyRoleConfig(
      { role: ROLE, title: 'Apply Station', form_schema: FORM_V1, escalation_targets: [TARGET] },
      true,
    );
    expect(outcome).toBe('applied');

    const schema = await roleService.getRoleSchema(ROLE);
    expect(schema?.version).toBe(1);
    expect(schema?.form_schema).toEqual(FORM_V1);
    expect(await roleService.getEscalationTargets(ROLE)).toEqual([TARGET]);
  });

  it('an identical second apply is a no-op — the version stays put', async () => {
    const outcome = await applyRoleConfig(
      { role: ROLE, title: 'Apply Station', form_schema: FORM_V1, escalation_targets: [TARGET] },
      true,
    );
    expect(outcome).toBe('unchanged');
    expect((await roleService.getRoleSchema(ROLE))?.version).toBe(1);
  });

  it('a changed form schema increments the version and snapshots with the startup summary', async () => {
    const outcome = await applyRoleConfig({ role: ROLE, form_schema: FORM_V2 }, true);
    expect(outcome).toBe('applied');

    const versions = await roleService.listRoleSchemaVersions(ROLE);
    expect(versions[0]).toMatchObject({ version: 2, change_summary: STARTUP_CHANGE_SUMMARY, is_current: true });
    // The prior version stays readable — lineage only grows.
    expect((await roleService.getRoleSchema(ROLE, 1))?.form_schema).toEqual(FORM_V1);
  });

  it('applies only declared fields — undeclared metadata is never touched', async () => {
    await roleService.updateRoleMetadata(ROLE, { sla_minutes: 45 });
    const outcome = await applyRoleConfig({ role: ROLE, title: 'Renamed Station' }, true);
    expect(outcome).toBe('applied');

    const detail = (await roleService.listRolesWithDetails()).find((r) => r.role === ROLE);
    expect(detail?.title).toBe('Renamed Station');
    expect(Number(detail?.sla_minutes)).toBe(45);
    // A re-apply of the same dial is still a no-op despite the driver's
    // string round-trip of numeric columns.
    expect(await applyRoleConfig({ role: ROLE, title: 'Renamed Station' }, true)).toBe('unchanged');
  });

  it('db-owned: metadata is written once at creation, then the DB owns the row', async () => {
    const first = await applyRoleConfig({ role: DB_ROLE, title: 'Original', form_schema: FORM_V1 }, false);
    expect(first).toBe('applied');

    const second = await applyRoleConfig({ role: DB_ROLE, title: 'Code Moved On', form_schema: FORM_V2 }, false);
    expect(second).toBe('db-owned');

    const detail = (await roleService.listRolesWithDetails()).find((r) => r.role === DB_ROLE);
    expect(detail?.title).toBe('Original');
    expect(detail?.current_schema_version).toBe(1);
  });
});
