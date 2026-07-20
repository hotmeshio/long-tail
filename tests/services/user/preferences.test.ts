import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import * as userService from '../../../services/user';
import { PREFERENCES_MAX_BYTES } from '../../../services/user';

const { Connection } = Durable;

// ─────────────────────────────────────────────────────────────────────────────
// User preferences — against real Postgres.
//
// Contract: a generic per-user JSON store; PATCH is a shallow top-level merge
// in ONE guarded UPDATE (null deletes a key, the statement refuses documents
// over the size cap). Pinned views are the first tenant, not the schema.
// ─────────────────────────────────────────────────────────────────────────────

describe('user preferences', () => {
  let userId: string;

  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    const user = await userService.createUser({
      external_id: `prefs-test-${Date.now()}`,
      display_name: 'Prefs Tester',
    });
    userId = user.id;
  }, 60_000);

  afterAll(async () => {
    if (userId) await userService.deleteUser(userId);
  });

  it('reads {} for a user who has never written preferences', async () => {
    expect(await userService.getPreferences(userId)).toEqual({});
  });

  it('patch writes and get reads back', async () => {
    const result = await userService.patchPreferences(userId, {
      theme: 'blue',
      pinnedViews: [{ id: 'p1', label: 'Needs harvesting', url: '/escalations/available?role=x' }],
    });
    expect(result?.theme).toBe('blue');
    expect(await userService.getPreferences(userId)).toEqual(result);
  });

  it('shallow merge: untouched top-level keys survive, provided keys overwrite whole', async () => {
    await userService.patchPreferences(userId, { pinnedViews: [] });
    const prefs = await userService.getPreferences(userId);
    expect(prefs.theme).toBe('blue');       // untouched key survives
    expect(prefs.pinnedViews).toEqual([]);  // provided key replaced wholesale
  });

  it('null deletes a key', async () => {
    const result = await userService.patchPreferences(userId, { theme: null });
    expect(result).not.toBeNull();
    expect('theme' in result!).toBe(false);
    expect(result!.pinnedViews).toEqual([]); // sibling untouched
  });

  it('refuses a merge that would exceed the size cap (nothing written)', async () => {
    const before = await userService.getPreferences(userId);
    const huge = 'x'.repeat(PREFERENCES_MAX_BYTES);
    const result = await userService.patchPreferences(userId, { blob: huge });
    expect(result).toBeNull();
    expect(await userService.getPreferences(userId)).toEqual(before);
  });

  it('returns null for an unknown user (no phantom row)', async () => {
    const result = await userService.patchPreferences(
      '00000000-0000-0000-0000-000000000000',
      { a: 1 },
    );
    expect(result).toBeNull();
  });
});

describe('role default_pins', () => {
  const ROLE = `pins-role-${Date.now()}`;

  beforeAll(async () => {
    const { createRole } = await import('../../../services/role');
    await createRole(ROLE);
  }, 30_000);

  afterAll(async () => {
    const { getPool } = await import('../../../lib/db');
    await getPool().query('DELETE FROM lt_roles WHERE role = $1', [ROLE]);
  });

  it('round-trips default_pins through updateRoleMetadata and the details list', async () => {
    const roleService = await import('../../../services/role');
    const pins = [
      { label: 'Needs harvesting', url: `/escalations/available?role=${ROLE}&jeopardy=1`, badge: true },
      { label: 'My machines', url: `/escalations/available?role=${ROLE}&view=table` },
    ];
    const updated = await roleService.updateRoleMetadata(ROLE, { default_pins: pins });
    expect(updated?.default_pins).toEqual(pins);

    const all = await roleService.listRolesWithDetails();
    const row = all.find((r) => r.role === ROLE);
    expect(row?.default_pins).toEqual(pins);

    // Clearing with null
    const cleared = await roleService.updateRoleMetadata(ROLE, { default_pins: null });
    expect(cleared?.default_pins).toBeNull();
  });
});
