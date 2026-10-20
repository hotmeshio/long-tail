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

/**
 * Whether an embedded action (a roster or list action on another row) runs
 * now or first asks for a badge. A login with its own write authority runs
 * it; a read-only station login runs it on a live grant that is not bound to
 * one subject, and asks for a badge otherwise.
 */
export function embedWriteRunsNow(
  memberships: readonly LTUserRole[] | undefined,
  scanEnabled: boolean,
  acting: { subjectScoped: boolean } | null,
): boolean {
  if (!scanEnabled || !isReadOnlyLogin(memberships)) return true;
  return !!acting && !acting.subjectScoped;
}
