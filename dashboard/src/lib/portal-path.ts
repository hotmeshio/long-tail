import type { RolePortal } from '../api/roles';

export const PORTAL_PATH_PREFIX = '/portal';

/** Whether a path is a portal page: a screen read from across a room, shown without the nav. */
export function isPortalPath(pathname: string): boolean {
  return pathname === PORTAL_PATH_PREFIX || pathname.startsWith(`${PORTAL_PATH_PREFIX}/`);
}

/** A portal page: the role's first portal when no key is named. */
export function portalPath(role: string, key?: string): string {
  const base = `${PORTAL_PATH_PREFIX}/${encodeURIComponent(role)}`;
  return key ? `${base}/${encodeURIComponent(key)}` : base;
}

/** The portals a role declares, in declared order. */
export function portalsOf(role: { portals?: RolePortal[] | null } | null | undefined): RolePortal[] {
  return Array.isArray(role?.portals) ? role.portals : [];
}

/** Whether a role declares at least one portal. */
export function hasPortals(role: { portals?: RolePortal[] | null } | null | undefined): boolean {
  return portalsOf(role).length > 0;
}

/** A portal key from its label: lowercase, url-safe, unique among the given keys. */
export function portalKeyFor(label: string, taken: Iterable<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'portal';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
