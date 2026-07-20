import { parseFacetParams } from './facet-url';
import type { PinnedView, UserPreferences } from '../api/preferences';
import type { FacetFilters } from '../api/escalations';

/**
 * Pinned views — the persona's bookmark set. A user's own pins come from
 * preferences; a role may seed defaults (default_pins) that appear for members
 * until promoted (copied to own) or hidden. Pins carry URLs only.
 */

export interface ResolvedPin extends PinnedView {
  /** True when this entry comes from a role's default_pins, not the user. */
  fromRole?: string;
}

/**
 * Merge the user's own pins with their roles' defaults. Own pins lead, in
 * stored order. A role default appears after them unless the user already has
 * an own pin with the same label (promoted) or has hidden it. First role to
 * claim a label wins — duplicates across roles collapse.
 */
export function resolvePins(
  prefs: UserPreferences | undefined,
  roleDefaults: { role: string; pins: PinnedView[] }[],
): ResolvedPin[] {
  const own = prefs?.pinnedViews ?? [];
  const hidden = new Set(prefs?.hiddenRolePins ?? []);
  const ownLabels = new Set(own.map((p) => p.label));

  const out: ResolvedPin[] = [...own];
  const seenRoleLabels = new Set<string>();
  for (const { role, pins } of roleDefaults) {
    for (const pin of pins) {
      if (ownLabels.has(pin.label) || hidden.has(pin.label) || seenRoleLabels.has(pin.label)) continue;
      seenRoleLabels.add(pin.label);
      out.push({ ...pin, id: `role:${role}:${pin.label}`, fromRole: role });
    }
  }
  return out;
}

/**
 * Parse a pinned escalations-list URL back into the query its badge counts —
 * the same parsers the list page itself uses, so the badge is definitionally
 * the number the pin opens onto. Returns null for any other URL (no badge).
 */
export function pinBadgeQuery(url: string): { available: boolean; params: Record<string, unknown> & FacetFilters } | null {
  let parsed: URL;
  try {
    parsed = new URL(url, 'http://local');
  } catch {
    return null;
  }
  if (parsed.pathname !== '/escalations/available' && parsed.pathname !== '/escalations') {
    return null;
  }
  const sp = parsed.searchParams;
  const facets = parseFacetParams(sp);
  const status = sp.get('status') || undefined;
  // Mirrors the list page: 'available' status routes through the available
  // pool; 'all' and unset span statuses on the plain list.
  const available = parsed.pathname === '/escalations/available'
    && (status === undefined || status === 'available');
  return {
    available,
    params: {
      ...facets,
      role: sp.get('role') || undefined,
      type: sp.get('type') || undefined,
      priority: sp.get('priority') ? parseInt(sp.get('priority')!, 10) : undefined,
      status: available || status === 'all' ? undefined : status,
      search: sp.get('search') || undefined,
    },
  };
}

/** A collision-resistant id for a new pin (no external dep). */
export function newPinId(): string {
  return `pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
