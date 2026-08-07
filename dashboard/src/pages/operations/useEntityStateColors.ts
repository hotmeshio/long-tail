import { useCallback, useMemo } from 'react';
import {
  useAggregateByFacets,
  useAnalyticsWindow,
  type TimelineInterval,
} from '../../api/escalation-analytics';
import { useRoleDetails } from '../../api/roles';
import { assignLabelColors } from './mix-colors';

/**
 * A category-color resolver for an entity system's timeline intervals — the
 * same palette the entity-lens band uses, so a timeline opened anywhere (the
 * lens, the station detail panel, an escalation cell popover) colors its dots
 * by state identically. Each interval's state is derived exactly as the server
 * does (subtype-sourced roles → COALESCE(subtype, role), everyone else → role),
 * then mapped through colors assigned over the system's state dwell.
 *
 * A stable reference window (not the user's selected period) keeps the color
 * assignment consistent across contexts. Pass `enabled: false` when the opener
 * already supplies its own resolver, so this does no redundant fetching.
 */
export function useEntityStateColors(
  scope: { entity?: string; role?: string },
  { enabled = true, periodHours = 720 }: { enabled?: boolean; periodHours?: number } = {},
): (interval: TimelineInterval) => string | undefined {
  const window = useAnalyticsWindow(periodHours);
  const query = scope.entity
    ? { entity: scope.entity }
    : scope.role
      ? { roles: [scope.role] }
      : null;
  const active = enabled && !!query;

  const dwell = useAggregateByFacets(
    active
      ? {
          query: query!,
          groupBy: { state: true },
          measure: { kind: 'dwell', window },
          orderBy: [{ field: 'dwellSeconds', direction: 'desc' }],
        }
      : null,
  );
  const now = useAggregateByFacets(
    active ? { query: query!, groupBy: { state: true }, measure: { kind: 'membership' } } : null,
  );
  const { data: roleData } = useRoleDetails({ enabled: active });

  const subtypeSourced = useMemo(
    () =>
      new Set(
        (roleData?.roles ?? [])
          .filter((r) => r.entity_state_source === 'subtype')
          .map((r) => r.role),
      ),
    [roleData],
  );
  const colors = useMemo(
    () =>
      assignLabelColors(
        [
          ...(dwell.data?.groups ?? []).filter((g) => (g.dwellSeconds ?? 0) > 0),
          ...(now.data?.groups ?? []),
        ].map((g) => ({ label: g.state ?? '—', weight: g.dwellSeconds ?? g.count ?? 0 })),
      ),
    [dwell.data, now.data],
  );

  return useCallback(
    (interval: TimelineInterval) => {
      const state = subtypeSourced.has(interval.role)
        ? (interval.subtype ?? interval.role)
        : interval.role;
      return colors.get(state);
    },
    [colors, subtypeSourced],
  );
}
