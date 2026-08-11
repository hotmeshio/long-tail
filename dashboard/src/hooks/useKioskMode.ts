import { useMemo } from 'react';
import { useAuth } from './useAuth';
import { useRoleDetails } from '../api/roles';

/**
 * Kiosk mode — the locked station viewport. A role opts in with
 * `properties.kiosk: true`; it engages only when the signed-in user is a
 * MEMBER of exactly that one role (the shared station-login shape: one role,
 * read_all/write_none). The shell then drops the left nav entirely, the
 * role's escalation list becomes home, and navigation is held to the list,
 * the detail page, and the scan screens. A user holding more than one role
 * (or an admin/superadmin grant) always gets the full chrome.
 */
export function useKioskMode(): {
  kiosk: boolean;
  /** The single role driving the kiosk, when engaged. */
  role: string | null;
  /** The locked home: the role's escalation list. */
  homePath: string | null;
} {
  const { user } = useAuth();
  const { data: roleDetails } = useRoleDetails();

  return useMemo(() => {
    const memberships = user?.roles ?? [];
    const only = memberships.length === 1 ? memberships[0] : null;
    if (!only || only.type !== 'member') return { kiosk: false, role: null, homePath: null };

    const detail = roleDetails?.roles?.find((r) => r.role === only.role);
    if (detail?.properties?.kiosk !== true) return { kiosk: false, role: null, homePath: null };

    return {
      kiosk: true,
      role: only.role,
      homePath: `/escalations/available?role=${encodeURIComponent(only.role)}&status=available`,
    };
  }, [user, roleDetails]);
}

/** Path prefixes a kiosk session may occupy; everything else redirects home. */
export const KIOSK_ALLOWED_PREFIXES = [
  '/escalations', // the role list + escalation detail
  '/scan',        // the scan station (choice screen, badge prompt)
  '/login',
];

export function isKioskAllowedPath(pathname: string): boolean {
  return KIOSK_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}?`));
}
