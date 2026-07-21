/**
 * Work-lane role classification. A user's task queues are the roles they are a
 * member of — the capability tiers below are access levels, never work lanes,
 * so membership-derived queue lists exclude them.
 */

export const SYSTEM_TIER_ROLES = ['superadmin', 'admin', 'engineer'] as const;

export function isSystemTierRole(role: string): boolean {
  return (SYSTEM_TIER_ROLES as readonly string[]).includes(role);
}
