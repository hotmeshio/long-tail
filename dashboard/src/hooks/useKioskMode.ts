import { useCallback, useMemo } from 'react';
import { useAuth } from './useAuth';
import { useMyRoles } from '../api/users';
import { useRoleDetails } from '../api/roles';
import { setSelectedRole, useStationRole } from '../lib/station-role-store';

export interface KioskState {
  kiosk: boolean;
  /** The role driving the kiosk home, when engaged. */
  role: string | null;
  /** The locked home: the role's escalation list. */
  homePath: string | null;
  /** Kiosk-flagged member roles selectable as the station home. */
  targets: string[];
  /** True when there are 2+ eligible targets for the station to choose between. */
  selectable: boolean;
  /** Persist this device's station home queue; null clears the choice. */
  selectRole: (role: string | null) => void;
}

/**
 * Kiosk mode — the locked station viewport. A role opts in with
 * `properties.kiosk: true`. It engages for a signed-in account whose grants are
 * all plain MEMBER (no admin/superadmin):
 *
 * - A single-role member of a kiosk role locks to that role (the original shape).
 * - A readonly station (every grant read-only, `write_scope: 'none'`) that is a
 *   member of several kiosk roles picks which one is home. With one flagged role
 *   it auto-locks; with several it stays in full chrome until one is chosen, then
 *   locks. The choice persists per device.
 *
 * The lock is a home/view selection only — scanning still spans every member role
 * and writes still require a badge, whatever the chosen home.
 */
export function useKioskMode(): KioskState {
  const { user } = useAuth();
  const userId = user?.userId ?? null;
  // Memberships come from the DB (with read/write scope), not the token, so the
  // read-only-station test holds whatever the login method.
  const { data: myRoles } = useMyRoles(userId);
  const { data: roleDetails } = useRoleDetails();
  const selected = useStationRole(userId);

  const selectRole = useCallback(
    (role: string | null) => {
      if (userId) setSelectedRole(userId, role);
    },
    [userId],
  );

  return useMemo(() => {
    const off: KioskState = {
      kiosk: false,
      role: null,
      homePath: null,
      targets: [],
      selectable: false,
      selectRole,
    };

    const memberships = myRoles ?? [];
    if (memberships.length === 0) return off;
    // Any admin/superadmin grant always gets the full chrome.
    if (memberships.some((m) => m.type !== 'member')) return off;

    const isTarget = (role: string) =>
      roleDetails?.roles?.find((r) => r.role === role)?.properties?.kiosk === true;
    const targets = memberships.map((m) => m.role).filter(isTarget);

    const home = (role: string): KioskState => ({
      kiosk: true,
      role,
      homePath: `/escalations/available?role=${encodeURIComponent(role)}&status=available`,
      targets,
      selectable: targets.length >= 2,
      selectRole,
    });

    // Single-role station — the original lock, unchanged.
    if (memberships.length === 1) {
      return targets.length === 1 ? home(targets[0]) : off;
    }

    // Multi-role station: only a fully readonly account is a station, never an operator.
    const readonly = memberships.every((m) => m.write_scope === 'none');
    if (!readonly || targets.length === 0) return off;

    const active =
      selected && targets.includes(selected)
        ? selected
        : targets.length === 1
          ? targets[0]
          : null;

    // 2+ targets and none chosen yet → full chrome, but offer the picker.
    if (!active) return { ...off, targets, selectable: true };
    return home(active);
  }, [myRoles, roleDetails, selected, selectRole]);
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
