import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { connectTelemetry, disconnectTelemetry } from '../../setup/telemetry';
import { migrate } from '../../../lib/db/migrate';
import * as personaService from '../../../services/persona';
import * as userService from '../../../services/user';
import type { LTUserRole } from '../../../types';

const { Connection } = Durable;

// ─────────────────────────────────────────────────────────────────────────────
// Persona assignment semantics
//
// Assignment fans a persona out to ordinary lt_user_roles memberships:
//   1. Fan-out — each linked role becomes a scoped `member` row with the
//      persona recorded as provenance (granted_by_persona).
//   2. Idempotence — re-assigning overlays fresh from the persona's current
//      links; editing links reconciles every holder.
//   3. Highest allowance — overlapping personas union per role; unassigning
//      one re-homes the row to the sibling and recomputes its scope.
//   4. Direct grants win — a direct role-add takes the row over; persona
//      unassign never removes it. Direct scopes are only raised, never lowered.
// ─────────────────────────────────────────────────────────────────────────────

const P_A = 'pa-manager';
const P_B = 'pa-servicer';
const P_EMPTY = 'pa-placeholder';
const USER = 'pa-user-1';

let userId: string;

function byRole(roles: LTUserRole[], role: string): LTUserRole | undefined {
  return roles.find((r) => r.role === role);
}

async function cleanup() {
  for (const key of [P_A, P_B, P_EMPTY]) {
    await personaService.deletePersona(key);
  }
  const stale = await userService.getUserByExternalId(USER);
  if (stale) await userService.deleteUser(stale.id);
}

describe('persona service — assignment', () => {
  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    await cleanup();

    const user = await userService.createUser({ external_id: USER });
    userId = user.id;

    await personaService.createPersona({ key: P_A, title: 'Manager' });
    await personaService.linkPersonaRole(P_A, 'pa-role-one', 'write-all');
    await personaService.linkPersonaRole(P_A, 'pa-role-two', 'read-all');

    await personaService.createPersona({ key: P_B, title: 'Servicer' });
    await personaService.linkPersonaRole(P_B, 'pa-role-two', 'write-all');
    await personaService.linkPersonaRole(P_B, 'pa-role-three', 'write-self');

    await personaService.createPersona({ key: P_EMPTY, title: 'Placeholder' });
  }, 30_000);

  afterAll(async () => {
    await cleanup();
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  it('fans out to scoped member rows with persona provenance', async () => {
    const recompute = await personaService.assignPersona(userId, P_A);
    expect(recompute!.granted).toBe(2);

    const roles = await userService.getUserRoles(userId);
    const one = byRole(roles, 'pa-role-one')!;
    expect(one.type).toBe('member');
    expect(one.read_scope).toBe('all');
    expect(one.write_scope).toBe('all');
    expect(one.granted_by_persona).toBe(P_A);

    const two = byRole(roles, 'pa-role-two')!;
    expect(two.write_scope).toBe('none');
    expect(two.granted_by_persona).toBe(P_A);
  });

  it('is idempotent — re-assigning overlays fresh without duplicating', async () => {
    const recompute = await personaService.assignPersona(userId, P_A);
    expect(recompute!.granted).toBe(0);
    expect(recompute!.refreshed).toBe(2);
    expect((await userService.getUserRoles(userId)).length).toBe(2);
  });

  it('propagates link edits to current holders (overlay fresh)', async () => {
    await personaService.linkPersonaRole(P_A, 'pa-role-two', 'write-self');
    let two = byRole(await userService.getUserRoles(userId), 'pa-role-two')!;
    expect(two.write_scope).toBe('self');

    await personaService.linkPersonaRole(P_A, 'pa-role-two', 'read-all');
    two = byRole(await userService.getUserRoles(userId), 'pa-role-two')!;
    expect(two.write_scope).toBe('none');
  });

  it('unions overlapping personas at the highest allowance per role', async () => {
    await personaService.assignPersona(userId, P_B);
    const roles = await userService.getUserRoles(userId);
    // pa-role-two: read-all from A ∪ write-all from B → write all.
    expect(byRole(roles, 'pa-role-two')!.write_scope).toBe('all');
    expect(byRole(roles, 'pa-role-three')!.write_scope).toBe('self');
  });

  it('re-homes shared rows to the sibling persona on unassign', async () => {
    const result = await personaService.unassignPersona(userId, P_B);
    expect(result.unassigned).toBe(true);

    const roles = await userService.getUserRoles(userId);
    expect(byRole(roles, 'pa-role-three')).toBeUndefined();
    // pa-role-two survives via A, overlaid back to A's read-all mapping.
    const two = byRole(roles, 'pa-role-two')!;
    expect(two.granted_by_persona).toBe(P_A);
    expect(two.write_scope).toBe('none');
  });

  it('lets a direct grant take the row over, surviving persona unassign', async () => {
    // Direct add on the persona-sustained pa-role-two: provenance flips to direct.
    await userService.addUserRole(userId, 'pa-role-two', 'member', {
      read_scope: 'all',
      write_scope: 'all',
    });
    let two = byRole(await userService.getUserRoles(userId), 'pa-role-two')!;
    expect(two.granted_by_persona ?? null).toBeNull();

    const result = await personaService.unassignPersona(userId, P_A);
    expect(result.unassigned).toBe(true);

    const roles = await userService.getUserRoles(userId);
    expect(byRole(roles, 'pa-role-one')).toBeUndefined();
    two = byRole(roles, 'pa-role-two')!;
    expect(two.write_scope).toBe('all');
  });

  it('raises a weaker direct grant toward the persona union, never lowers it', async () => {
    // Direct read-only membership; persona A grants write-all on the same role.
    await userService.addUserRole(userId, 'pa-role-one', 'member', {
      read_scope: 'all',
      write_scope: 'none',
    });
    await personaService.assignPersona(userId, P_A);

    const one = byRole(await userService.getUserRoles(userId), 'pa-role-one')!;
    expect(one.write_scope).toBe('all');
    expect(one.granted_by_persona ?? null).toBeNull();

    // Re-assigning a weaker persona never lowers the direct row back down.
    const two = byRole(await userService.getUserRoles(userId), 'pa-role-two')!;
    expect(two.write_scope).toBe('all');
  });

  it('fans out a new link to holders and removes their membership on unlink', async () => {
    await personaService.linkPersonaRole(P_A, 'pa-role-four', 'read-all');
    const four = byRole(await userService.getUserRoles(userId), 'pa-role-four')!;
    expect(four.granted_by_persona).toBe(P_A);
    expect(four.write_scope).toBe('none');

    await personaService.unlinkPersonaRole(P_A, 'pa-role-four');
    const roles = await userService.getUserRoles(userId);
    expect(byRole(roles, 'pa-role-four')).toBeUndefined();
    // Direct rows are untouched by link edits.
    expect(byRole(roles, 'pa-role-two')).toBeTruthy();
    expect(byRole(roles, 'pa-role-one')).toBeTruthy();
  });

  it('supports zero-role personas as placeholders', async () => {
    const recompute = await personaService.assignPersona(userId, P_EMPTY);
    expect(recompute).toEqual({ granted: 0, refreshed: 0, raised: 0, removed: 0 });
    const { personas } = await personaService.getUserPersonas(userId);
    expect(personas.some((p) => p.key === P_EMPTY)).toBe(true);
  });

  it('composes the forUser map with sustaining personas', async () => {
    await personaService.assignPersona(userId, P_B);
    const { personas, roles } = await personaService.getUserPersonas(userId);
    expect(personas.map((p) => p.key).sort()).toEqual([P_A, P_EMPTY, P_B].sort());

    const three = roles.find((r) => r.role === 'pa-role-three')!;
    expect(three.granted_by_persona).toBe(P_B);
    const one = roles.find((r) => r.role === 'pa-role-one')!;
    expect(one.granted_by_persona).toBeNull();
  });

  it('reports not-held and not-found unassigns distinctly', async () => {
    expect((await personaService.unassignPersona(userId, P_A)).unassigned).toBe(true);
    expect((await personaService.unassignPersona(userId, P_A)).unassigned).toBe(false);
    expect((await personaService.unassignPersona(userId, 'pa-missing')).personaFound).toBe(false);
  });

  it('cleans sustained memberships when the persona is deleted', async () => {
    const before = byRole(await userService.getUserRoles(userId), 'pa-role-three')!;
    expect(before.granted_by_persona).toBe(P_B);

    const result = await personaService.deletePersona(P_B);
    expect(result.deleted).toBe(true);

    const roles = await userService.getUserRoles(userId);
    expect(byRole(roles, 'pa-role-three')).toBeUndefined();
    // Direct rows survive persona deletion.
    expect(byRole(roles, 'pa-role-one')).toBeTruthy();
  });
});
