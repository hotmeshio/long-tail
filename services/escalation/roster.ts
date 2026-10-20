/**
 * Server-side roster counts: the API-first counterpart of the dashboard's
 * roster widget. For each `x-lt-roster` field of a form schema, the member
 * rows are read with the same query the widget runs and the shared
 * `computeRoster` turns them into counts, so `roster.*` showIf conditions and
 * a roster submit guard evaluate at resolve exactly as the form showed them.
 *
 * Member rows are read with `global: true`: a resolver who cannot see a
 * member must never be told the roster is complete.
 */
import {
  computeRoster,
  readRosterDefs,
  resolveRosterQuery,
  rosterQueryOf,
  rosterRowContext,
  type RosterCounts,
  type RosterRow,
  type ShowIfContext,
} from '../../shared/form-validation';
import { searchEscalationsFaceted } from './queries';

/** Each roster field's counts, keyed by field name; empty when the schema declares none. */
export async function loadRosterCounts(
  schema: Record<string, unknown> | null | undefined,
  ctx: ShowIfContext,
): Promise<Record<string, RosterCounts>> {
  const defs = readRosterDefs(schema);
  const counts: Record<string, RosterCounts> = {};
  for (const [field, def] of Object.entries(defs)) {
    counts[field] = computeRoster(def, ctx, await readMemberRows(def, ctx)).counts;
  }
  return counts;
}

async function readMemberRows(
  def: Parameters<typeof rosterQueryOf>[0],
  ctx: ShowIfContext,
): Promise<RosterRow[]> {
  const query = rosterQueryOf(def);
  const scoped = query ? resolveRosterQuery(query, ctx) : null;
  if (!scoped) return [];
  const { escalations } = await searchEscalationsFaceted({
    global: true,
    facet: { roles: scoped.roles, status: scoped.status, facets: scoped.facets },
    limit: scoped.limit,
    offset: 0,
  });
  return escalations.map((row) => rosterRowContext(row as unknown as Record<string, unknown>));
}
