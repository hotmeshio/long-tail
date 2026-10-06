import { ROLE_PROPERTY_KEYS, type RoleBadgeGrant } from './types';

const SCOPES = ['action', 'subject'];

/** The problem with a `properties.badge_grant` value, or null when it is usable (or absent). */
export function badgeGrantError(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return 'properties.badge_grant must be an object';
  const grant = value as Record<string, unknown>;
  const known = new Set(['ttl_seconds', 'max_uses', 'scope']);
  const extra = Object.keys(grant).filter((k) => !known.has(k));
  if (extra.length) return `properties.badge_grant has unknown key(s): ${extra.join(', ')}`;
  if (grant.ttl_seconds !== undefined
    && (!Number.isInteger(grant.ttl_seconds) || (grant.ttl_seconds as number) < 1 || (grant.ttl_seconds as number) > 86_400)) {
    return 'properties.badge_grant.ttl_seconds must be an integer from 1 to 86400';
  }
  if (grant.max_uses !== undefined && (!Number.isInteger(grant.max_uses) || (grant.max_uses as number) < 0)) {
    return 'properties.badge_grant.max_uses must be a non-negative integer';
  }
  if (grant.scope !== undefined && !SCOPES.includes(grant.scope as string)) {
    return `properties.badge_grant.scope must be one of ${SCOPES.join(', ')}`;
  }
  return null;
}

/** The role's badge policy from its properties bag, or null when it declares none (or an unusable one). */
export function readBadgeGrant(properties: Record<string, unknown> | null | undefined): RoleBadgeGrant | null {
  const value = properties?.[ROLE_PROPERTY_KEYS.BADGE_GRANT];
  if (value === undefined || value === null || badgeGrantError(value)) return null;
  return value as RoleBadgeGrant;
}
