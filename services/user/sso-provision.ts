import { loggerRegistry } from '../../lib/logger';
import { getUserByExternalId, createUser } from './crud';
import { addUserRole, getUserRoles } from './roles';
import type { SSOIdentity, LTSSOConfig } from '../../types/auth';
import type { LTRoleType } from '../../types';

export interface ProvisionedUser {
  userId: string;
  roles: Array<{ role: string; type: string }>;
  created: boolean;
}

/**
 * JIT provision or sync an SSO identity to lt_users.
 *
 * Lookup by `external_id`. If not found, create with resolved roles.
 * If found, sync any new roles from the identity.
 *
 * Returns the internal `lt_users.id` (UUID) that all RBAC and
 * escalation queries use.
 */
export async function ssoProvision(
  identity: SSOIdentity,
  ssoConfig: LTSSOConfig,
): Promise<ProvisionedUser> {
  const defaultRoleType = ssoConfig.defaultRoleType || 'member';
  const ltRoles = resolveRoles(identity.roles || [], defaultRoleType, ssoConfig.roleMap);

  const existing = await getUserByExternalId(identity.externalId);
  if (existing) {
    return syncExistingUser(existing.id, ltRoles);
  }

  // Create new user. Two concurrent first-logins for the same identity can both
  // pass the existence check above; external_id UNIQUE is the arbiter. The loser's
  // insert raises 23505 — adopt the winner's committed row and sync roles rather
  // than failing the login.
  try {
    const user = await createUser({
      external_id: identity.externalId,
      email: identity.email || undefined,
      display_name: identity.displayName || identity.externalId,
      roles: ltRoles.map((r) => ({ role: r.role, type: r.type as LTRoleType })),
      metadata: identity.metadata,
    });

    loggerRegistry.info(`[lt-sso] provisioned user: ${identity.externalId} → ${user.id}`);

    return {
      userId: user.id,
      roles: (user.roles || []).map((r) => ({ role: r.role, type: r.type })),
      created: true,
    };
  } catch (err: any) {
    if (err?.code === '23505') {
      const winner = await getUserByExternalId(identity.externalId);
      if (winner) {
        return syncExistingUser(winner.id, ltRoles);
      }
    }
    throw err;
  }
}

/** Ensure all resolved roles exist on an already-provisioned user. */
async function syncExistingUser(
  userId: string,
  ltRoles: Array<{ role: string; type: string }>,
): Promise<ProvisionedUser> {
  const currentRoles = await getUserRoles(userId);
  for (const lr of ltRoles) {
    const has = currentRoles.some((r) => r.role === lr.role);
    if (!has) {
      await addUserRole(userId, lr.role, lr.type as LTRoleType);
    }
  }
  const updatedRoles = await getUserRoles(userId);
  return {
    userId,
    roles: updatedRoles.map((r) => ({ role: r.role, type: r.type })),
    created: false,
  };
}

function resolveRoles(
  hostRoles: string[],
  defaultRoleType: string,
  roleMap?: Record<string, string>,
): Array<{ role: string; type: string }> {
  const mapped = roleMap
    ? hostRoles.filter((r) => roleMap[r]).map((r) => roleMap[r])
    : hostRoles;

  if (mapped.length === 0) {
    return [{ role: defaultRoleType, type: defaultRoleType }];
  }

  return mapped.map((role) => ({
    role,
    type: role === 'superadmin' ? 'superadmin' : role === 'admin' ? 'admin' : 'member',
  }));
}
