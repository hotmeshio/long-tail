import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { connectTelemetry, disconnectTelemetry } from '../../setup/telemetry';
import { migrate } from '../../../lib/db/migrate';
import * as roleService from '../../../services/role';

const { Connection } = Durable;

// ─────────────────────────────────────────────────────────────────────────────
// ops_home_default — the home Pace Board's default segment marker.
//
// Single-holder: setting it on one role clears it on every other role in the
// same atomic statement. PATCH semantics: an update that omits it leaves it
// alone; unsetting it leaves no holder (the home board falls back to the
// primary segment).
// ─────────────────────────────────────────────────────────────────────────────

const R1 = 'ohd-station-one';
const R2 = 'ohd-station-two';

async function holders(): Promise<string[]> {
  const roles = await roleService.listRolesWithDetails();
  return roles.filter((r) => r.ops_home_default).map((r) => r.role);
}

describe('role service — ops_home_default', () => {
  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    await roleService.createRole(R1);
    await roleService.createRole(R2);
    await roleService.updateRoleMetadata(R1, { ops_home_default: false });
    await roleService.updateRoleMetadata(R2, { ops_home_default: false });
  }, 30_000);

  afterAll(async () => {
    await roleService.updateRoleMetadata(R1, { ops_home_default: false });
    await roleService.updateRoleMetadata(R2, { ops_home_default: false });
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  it('defaults to false and sets on demand', async () => {
    const before = await roleService.listRolesWithDetails();
    expect(before.find((r) => r.role === R1)!.ops_home_default).toBe(false);

    const updated = await roleService.updateRoleMetadata(R1, { ops_home_default: true });
    expect(updated!.ops_home_default).toBe(true);
    expect(await holders()).toEqual([R1]);
  });

  it('is single-holder — setting a second role releases the first', async () => {
    await roleService.updateRoleMetadata(R2, { ops_home_default: true });
    expect(await holders()).toEqual([R2]);
  });

  it('PATCH semantics — an unrelated update leaves the holder alone', async () => {
    await roleService.updateRoleMetadata(R2, { title: 'Station Two' });
    expect(await holders()).toEqual([R2]);
  });

  it('unsets cleanly, leaving no holder', async () => {
    await roleService.updateRoleMetadata(R2, { ops_home_default: false });
    expect(await holders()).toEqual([]);
  });
});
