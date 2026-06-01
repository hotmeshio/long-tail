import { loggerRegistry } from '../../lib/logger';
import { createRole } from '../role';
import { getUserByExternalId, createUser } from './crud';
import { addUserRole, getUserRoles } from './roles';

export interface SeedAdminInput {
  externalId: string;
  displayName?: string;
  email?: string;
  password?: string;
}

/**
 * Seed a superadmin user. Idempotent — skips creation if the user
 * already exists, but ensures the superadmin role is present.
 *
 * Returns the user's UUID so callers can pass it to `createClient()`.
 */
export async function seedAdmin(input: SeedAdminInput): Promise<string> {
  const { externalId, displayName, email, password } = input;

  // Ensure the superadmin role exists
  try {
    await createRole('superadmin');
  } catch { /* ON CONFLICT DO NOTHING */ }

  const existing = await getUserByExternalId(externalId);
  if (existing) {
    // Ensure existing user has the superadmin role
    const roles = await getUserRoles(existing.id);
    const hasSuperadmin = roles.some(
      (r) => r.role === 'superadmin' && r.type === 'superadmin',
    );
    if (!hasSuperadmin) {
      await addUserRole(existing.id, 'superadmin', 'superadmin');
      loggerRegistry.info(`[seed-admin] granted superadmin role to ${externalId}`);
    }
    loggerRegistry.info(`[seed-admin] ${externalId} already exists, skipping creation`);
    return existing.id;
  }

  const user = await createUser({
    external_id: externalId,
    email: email || undefined,
    display_name: displayName || externalId,
    password: password || undefined,
    roles: [{ role: 'superadmin', type: 'superadmin' }],
  });
  loggerRegistry.info(`[seed-admin] created superadmin user: ${externalId}`);
  return user.id;
}
