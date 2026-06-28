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
    return ensureSuperadmin(existing.id, externalId);
  }

  // Create. Concurrent container startups can both reach here; external_id UNIQUE
  // is the arbiter — on the loser's 23505, adopt the winner's row instead of
  // crashing the boot sequence.
  try {
    const user = await createUser({
      external_id: externalId,
      email: email || undefined,
      display_name: displayName || externalId,
      password: password || undefined,
      roles: [{ role: 'superadmin', type: 'superadmin' }],
    });
    loggerRegistry.info(`[seed-admin] created superadmin user: ${externalId}`);
    return user.id;
  } catch (err: any) {
    if (err?.code === '23505') {
      const winner = await getUserByExternalId(externalId);
      if (winner) {
        return ensureSuperadmin(winner.id, externalId);
      }
    }
    throw err;
  }
}

/** Ensure an existing user carries the superadmin role; returns its id. */
async function ensureSuperadmin(userId: string, externalId: string): Promise<string> {
  const roles = await getUserRoles(userId);
  const hasSuperadmin = roles.some(
    (r) => r.role === 'superadmin' && r.type === 'superadmin',
  );
  if (!hasSuperadmin) {
    await addUserRole(userId, 'superadmin', 'superadmin');
    loggerRegistry.info(`[seed-admin] granted superadmin role to ${externalId}`);
  }
  loggerRegistry.info(`[seed-admin] ${externalId} already exists, skipping creation`);
  return userId;
}
