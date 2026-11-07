import * as scanCodeService from '../../services/scan-code';
import * as escalationService from '../../services/escalation';
import { getRoleTitle } from '../../services/role';
import { getEscalationReadScope } from '../escalations/helpers';
import { restrictScopeRoles } from '../escalations/metadata';
import type { ScanStep } from '../../types';
import { targetValue, type StepContext } from './context';

/** True when the step's copy or Open reads the scanned code's own pending row. */
export function readsLocated(step: ScanStep): boolean {
  return step.open?.target === 'located'
    || scanCodeService.mentionsLocatedToken(step.refuse)
    || scanCodeService.mentionsLocatedToken(step.done);
}

/**
 * The scanned code's own pending row, read once per request: the newest
 * pending row whose scheme facet holds the scanned target, in any role the
 * actor may read, other than the held subject. Sets null when there is none.
 */
export async function loadLocated(ctx: StepContext): Promise<void> {
  if (ctx.located !== undefined) return;
  const scope = await getEscalationReadScope(ctx.auth.userId);
  const roles = restrictScopeRoles(scope.allRoles, scope.global);
  if (roles !== null && roles.length === 0) {
    ctx.located = null;
    return;
  }
  const found = await escalationService.searchByFacets({
    roles: roles ?? undefined,
    facets: { [ctx.scheme.target_facet]: targetValue(ctx) },
    status: 'pending',
    orderBy: [{ field: 'created_at', direction: 'desc' }],
    limit: 2,
  }, { total: false });
  const row = found.escalations.find((r) => r.id !== ctx.subject?.row.id) ?? null;
  ctx.located = row;
  ctx.locatedTitle = row ? await getRoleTitle(row.role) : null;
}
