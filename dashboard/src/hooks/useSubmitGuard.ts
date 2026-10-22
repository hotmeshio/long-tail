import { useEscalations } from '../api/escalations';
import { useAuth } from './useAuth';
import { interpolateHelp } from '../lib/x-lt-help';
import { resolveScopedQuery } from '../lib/x-lt-query';
import { SUBMIT_GUARD_DEFAULT_MESSAGE, type SubmitGuardDef } from '../lib/x-lt-submit-guard';
import type { ShowIfContext } from '../lib/x-lt-show-if';
import { ROSTER_GUARD_DEFAULT_MESSAGE } from '../lib/x-lt-submit-guard';
import type { RosterView } from './useRosters';

export type { SubmitGuardDef } from '../lib/x-lt-submit-guard';

/**
 * The `x-lt-submit-guard` gate on the resolve button. While the embedded query
 * still returns rows the submit stays disabled and `message` renders the live
 * count; the moment the last row resolves, the existing socket-invalidation
 * path refires the query and the button lights up. No polling.
 *
 * Only a CONFIRMED empty read clears the gate — a successful query returning
 * zero rows. Loading, an error, or a 403 never clear it: the button stays
 * disabled until the guard can prove there is nothing left. `confirmedEmpty`
 * is the same signal the page's auto-resolve waits on.
 *
 * The server enforces the identical precondition for `enforce_schema` roles
 * (services/escalation/submit-guard.ts), so a raw-API resolve is rejected too.
 */
export interface SubmitGuardState {
  blocked: boolean;
  count: number;
  message: string;
  /** True only on a successful read with zero rows — never while loading or errored. */
  confirmedEmpty: boolean;
}

export function useSubmitGuard(
  guard: SubmitGuardDef | undefined,
  ctx: ShowIfContext | undefined,
  rosters: Record<string, RosterView> = {},
): SubmitGuardState {
  const { user } = useAuth();

  // The SAME mapping the escalation-list embed uses (resolveScopedQuery) —
  // including the `assigned` ownership scope — so the guard's count always
  // matches the rows a same-query embed renders.
  const scoped = resolveScopedQuery(guard?.query ?? {}, ctx ?? {}, user?.userId);

  const isRosterGuard = !!guard?.roster;
  const { data, isSuccess } = useEscalations({
    role: scoped.role,
    status: scoped.status,
    facets: scoped.facets,
    assigned_to: scoped.assigned_to,
    available: scoped.available,
    limit: 1, // the gate needs only the total; rows are irrelevant
    enabled: !!guard && !isRosterGuard && scoped.enabled,
  });
  if (guard && isRosterGuard) return rosterGuardState(guard, rosters, ctx);

  // A guard whose scope cannot be evaluated (no role/facets, or `assigned:'me'`
  // with no viewer) is inert — it neither blocks nor auto-resolves. When the
  // scope IS evaluable, only a successful empty read clears the gate.
  const active = !!guard && guard.mustBeEmpty !== false && scoped.enabled;
  const count = data?.total ?? 0;
  const confirmedEmpty = active && isSuccess && count === 0;
  const blocked = active && !confirmedEmpty;

  // {{count}} is a local token — substitute it BEFORE the domain pass, which
  // replaces unknown domains with the missing-value dash. While blocked without
  // a confirmed count (loading/error), a count message would lie, so show a
  // neutral checking line instead.
  let message = '';
  if (blocked) {
    if (count > 0) {
      const template = guard?.message ?? SUBMIT_GUARD_DEFAULT_MESSAGE;
      message = interpolateHelp(template.replace(/\{\{count\}\}/g, String(count)), ctx ?? {});
    } else {
      message = 'Checking related items…';
    }
  }

  return { blocked, count, message, confirmedEmpty };
}

/**
 * A roster guard holds the submit while its roster has outstanding entries,
 * reading the same result the widget renders. A roster still loading, or one
 * the form does not declare, holds it too. A roster guard never auto-submits.
 */
function rosterGuardState(
  guard: SubmitGuardDef,
  rosters: Record<string, RosterView>,
  ctx: ShowIfContext | undefined,
): SubmitGuardState {
  const field = guard.roster!;
  if (!(field in rosters)) {
    return { blocked: true, count: 0, message: `Submit guard names roster "${field}", which the form does not declare`, confirmedEmpty: false };
  }
  const view = rosters[field];
  if (!view) return { blocked: true, count: 0, message: 'Checking expected items…', confirmedEmpty: false };
  const count = view.counts.outstanding;
  if (count <= 0) return { blocked: false, count: 0, message: '', confirmedEmpty: false };
  const template = guard.message ?? ROSTER_GUARD_DEFAULT_MESSAGE;
  return {
    blocked: true,
    count,
    message: interpolateHelp(template.replace(/\{\{count\}\}/g, String(count)), ctx ?? {}),
    confirmedEmpty: false,
  };
}
