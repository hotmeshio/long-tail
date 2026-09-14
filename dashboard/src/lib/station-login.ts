import type { LTUserRole } from '../api/types/users';

/**
 * The shared station device signs in as a read-only account: plain member
 * grants only, none able to write. Every mutation from such a login owes a
 * badge. A login holding its own write authority anywhere (an operator's
 * write scope, an admin or superadmin grant) is a person, acts under its own
 * RBAC, and is never routed through the station badge flow.
 */
export function isReadOnlyLogin(memberships: readonly LTUserRole[] | undefined): boolean {
  const ms = memberships ?? [];
  return ms.length > 0 && ms.every((m) => m.type === 'member' && m.write_scope === 'none');
}
