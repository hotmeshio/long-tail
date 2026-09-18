import { parseEscalationListUrl, resolveListRoute } from './escalation-list-url';
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
 * A pinned escalations-list URL as the query its badge counts: the same
 * parser and routing the list page uses, so the badge is definitionally the
 * number the pin opens onto. Null for any other URL (no badge).
 */
export function pinBadgeQuery(url: string): { available: boolean; params: Record<string, unknown> & FacetFilters } | null {
  const list = parseEscalationListUrl(url);
  if (!list) return null;
  const { available, claimed, apiStatus } = resolveListRoute(list.statusFilter);
  return {
    available,
    params: {
      ...list.facets,
      role: list.role,
      type: list.type,
      priority: list.priority,
      status: apiStatus,
      ...(claimed ? { claimed: true } : {}),
      search: list.search,
    },
  };
}

/** A collision-resistant id for a new pin (no external dep). */
export function newPinId(): string {
  return `pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
