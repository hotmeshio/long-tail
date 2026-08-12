import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { connectTelemetry, disconnectTelemetry } from '../../setup/telemetry';
import { migrate } from '../../../lib/db/migrate';
import * as userService from '../../../services/user';
import { ssoProvision } from '../../../services/user/sso-provision';
import type { LTSSOConfig } from '../../../types/auth';

const { Connection } = Durable;

// ─────────────────────────────────────────────────────────────────────────────
// SSO scope preservation — the v0.12.2 regression contract.
//
// SSO synchronizes IDENTITY, never authorization scope. Once a grant exists,
// repeated provisioning (every login, every requireAuth SSO fallback, every
// keepalive beat) leaves its type/scope/provenance exactly as the admin set
// it. A configured roleMap is the complete contract: an unmapped host role
// grants nothing — no injected default membership.
// ─────────────────────────────────────────────────────────────────────────────

const EXT_ID = 'sso-scope-preservation-user';
const ROLE = 'sso-scope-station';

const ssoConfig: LTSSOConfig = {
  resolve: () => null,
  roleMap: { HOST_STATION: ROLE },
};

describe('SSO scope preservation', () => {
  let userId: string;

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    const stale = await userService.getUserByExternalId(EXT_ID);
    if (stale) await userService.deleteUser(stale.id);
  }, 30_000);

  afterAll(async () => {
    const user = await userService.getUserByExternalId(EXT_ID);
    if (user) await userService.deleteUser(user.id);
    await disconnectTelemetry();
    await Durable.shutdown();
  }, 30_000);

  it('provisions the mapped role on first login', async () => {
    const result = await ssoProvision(
      { externalId: EXT_ID, displayName: 'Station', roles: ['HOST_STATION'] },
      ssoConfig,
    );
    userId = result.userId;
    expect(result.roles).toEqual([{ role: ROLE, type: 'member' }]);
  });

  it('an admin-restricted scope survives repeated provisioning', async () => {
    // The badge contract: the station must stay write:none.
    await userService.addUserRole(userId, ROLE, 'member', {
      read_scope: 'all',
      write_scope: 'none',
    });

    for (let i = 0; i < 5; i += 1) {
      await ssoProvision(
        { externalId: EXT_ID, displayName: 'Station', roles: ['HOST_STATION'] },
        ssoConfig,
      );
    }

    const grant = (await userService.getUserRoles(userId)).find((r) => r.role === ROLE)!;
    expect(grant.read_scope).toBe('all');
    expect(grant.write_scope).toBe('none');
    expect(grant.type).toBe('member');
  });

  it('grantRoleIfAbsent returns null on an existing row and changes nothing', async () => {
    const result = await userService.grantRoleIfAbsent(userId, ROLE, 'member');
    expect(result).toBeNull();
    const grant = (await userService.getUserRoles(userId)).find((r) => r.role === ROLE)!;
    expect(grant.write_scope).toBe('none');
  });

  it('an unmapped host role grants nothing — a removed membership stays removed', async () => {
    // Admin removes the grant; the operator's host role no longer maps.
    await userService.removeUserRole(userId, ROLE);
    for (let i = 0; i < 3; i += 1) {
      await ssoProvision(
        { externalId: EXT_ID, displayName: 'Station', roles: ['UNMAPPED_EDITOR'] },
        ssoConfig,
      );
    }
    const roles = await userService.getUserRoles(userId);
    expect(roles.find((r) => r.role === ROLE)).toBeUndefined();
    // No injected default membership either.
    expect(roles.find((r) => r.role === 'member')).toBeUndefined();
  });
});
