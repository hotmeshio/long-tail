import { useQueries } from '@tanstack/react-query';
import { escalationListQuery } from '../api/escalations';
import { schemaNeedsEnvelope } from '../lib/schema-needs-envelope';
import {
  computeRoster,
  readRosterDefs,
  resolveRosterQuery,
  rosterQueryOf,
  rosterRowContext,
  type RosterDef,
  type RosterResult,
  type RosterRow,
} from '../lib/x-lt-roster';
import type { ShowIfContext } from '../lib/x-lt-show-if';

/** A roster's result, or null while its member rows are loading or failed to load. */
export type RosterView = RosterResult | null;

function listFiltersFor(def: RosterDef, ctx: ShowIfContext) {
  const query = rosterQueryOf(def);
  const scoped = query ? resolveRosterQuery(query, ctx) : null;
  if (!scoped) return null;
  return {
    roles: scoped.roles,
    status: scoped.status,
    facets: scoped.facets,
    limit: scoped.limit,
    include: schemaNeedsEnvelope({ key: def.key, flagged: def.flagged }) ? ('envelope' as const) : undefined,
  };
}

/**
 * Every roster of a form, by field name. Member rows load through the shared
 * list query, so a roster refreshes on the same escalation events as every
 * list, and the widget and the page read one cached result. `ctx` carries
 * the live form values under `resolver`.
 */
export function useRosters(
  schema: Record<string, unknown> | null | undefined,
  ctx: ShowIfContext | undefined,
): Record<string, RosterView> {
  const defs = Object.entries(readRosterDefs(schema));
  const host = ctx ?? {};
  const filters = defs.map(([, def]) => listFiltersFor(def, host));
  const reads = useQueries({
    queries: filters.map((f) => ({
      ...escalationListQuery(f ?? {}),
      enabled: !!f,
    })),
  });

  const views: Record<string, RosterView> = {};
  defs.forEach(([field, def], i) => {
    if (!filters[i]) {
      views[field] = computeRoster(def, host);
      return;
    }
    const read = reads[i];
    if (!read.isSuccess) {
      views[field] = null;
      return;
    }
    const rows: RosterRow[] = read.data.escalations.map((e) => rosterRowContext(e as unknown as Record<string, unknown>));
    views[field] = computeRoster(def, host, rows);
  });
  return views;
}

/** The `roster` context domain: each loaded roster's counts. */
export function rosterContext(views: Record<string, RosterView>): Record<string, unknown> | null {
  const loaded = Object.entries(views).filter(([, v]) => v !== null);
  if (!loaded.length) return null;
  return Object.fromEntries(loaded.map(([field, v]) => [field, v!.counts]));
}
