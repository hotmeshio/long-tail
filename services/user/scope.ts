import type { LTReadScope, LTRoleType, LTWriteScope } from '../../types';

// ─── Role scope: the work-surface axes for an open-role membership ───────────
//
// A membership's `type` (member/admin/superadmin) is the management/global tier.
// Orthogonal to it, a member also carries two scope axes that gate the four task
// queue verbs:
//
//   read_scope  (self | all)        → governs SEARCH (which items appear)
//   write_scope (none | self | all) → governs CLAIM / ACK / DELETE (which items
//                                      the user may act on)
//
// `self` = items assigned to the user (`assigned_to = userId`). `all` = the whole
// role queue. The only constraint is write ⊆ read: you cannot act on what you
// cannot see (enforced in the DB by chk_lt_user_roles_scope). admin/superadmin
// ignore scope and always operate on all.

export const READ_SCOPES: LTReadScope[] = ['self', 'all'];
export const WRITE_SCOPES: LTWriteScope[] = ['none', 'self', 'all'];

/** Defaults preserve legacy `member` behavior (full role worker). */
export const DEFAULT_READ_SCOPE: LTReadScope = 'all';
export const DEFAULT_WRITE_SCOPE: LTWriteScope = 'all';

export function isValidReadScope(scope: string): scope is LTReadScope {
  return READ_SCOPES.includes(scope as LTReadScope);
}

export function isValidWriteScope(scope: string): scope is LTWriteScope {
  return WRITE_SCOPES.includes(scope as LTWriteScope);
}

/**
 * Is (read, write) a valid point in the lattice? Enforces write ⊆ read:
 * write='all' requires read='all'. (write='self'/'none' allowed under read='self'.)
 */
export function isValidScopePair(read: LTReadScope, write: LTWriteScope): boolean {
  return !(write === 'all' && read === 'self');
}

/**
 * Resolve the scope a membership actually grants. The management tier
 * (admin/superadmin) short-circuits both axes to `all` — those users always
 * search and act on the whole role queue regardless of stored scope columns.
 */
export function effectiveScope(
  type: LTRoleType,
  read: LTReadScope,
  write: LTWriteScope,
): { read: LTReadScope; write: LTWriteScope } {
  if (type === 'admin' || type === 'superadmin') {
    return { read: 'all', write: 'all' };
  }
  return { read, write };
}
