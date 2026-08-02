import * as scanCodeService from '../../services/scan-code';
import * as escalationService from '../../services/escalation';
import { restrictScopeRoles } from '../escalations/metadata';
import { getEscalationReadScope } from '../escalations/helpers';
import {
  SCAN_AVAILABILITY,
  SCAN_CARDINALITY,
  SCAN_OUTCOMES,
  SCAN_VERBS,
  type LTEscalationRecord,
  type ScanExecuteResponse,
  type ScanStep,
} from '../../types';
import type { LTApiResult } from '../../types/sdk';
import { executed, targetFilter, templateContext, type StepContext } from './context';

/**
 * The scoped locate every read path shares: the scanned target pinned to the
 * scheme's facet, the step's extra guards, and the EFFECTIVE actor's read
 * scope. Returns null when the caller's scope leaves no roles to search.
 */
export async function locateForStep(
  step: ScanStep,
  ctx: StepContext,
  limit: number,
): Promise<{ escalations: LTEscalationRecord[]; total: number } | null> {
  const scope = await getEscalationReadScope(ctx.auth.userId);
  const availability = step.query?.availability ?? SCAN_AVAILABILITY.ANY;
  const status: 'pending' | 'resolved' | 'cancelled' = step.query?.status ?? 'pending';
  const facets = targetFilter(step, ctx);

  if (availability === SCAN_AVAILABILITY.MINE) {
    // "mine" = assigned to the caller; self-scope roles qualify because the
    // assigned_to predicate satisfies their visibility branch.
    const readable = [...scope.allRoles, ...scope.selfRoles];
    const roles = restrictScopeRoles(readable, scope.global, step.query?.roles);
    if (roles !== null && roles.length === 0) return null;
    return escalationService.listEscalations({
      metadata: facets,
      status,
      assigned_to: ctx.auth.userId,
      visibleRoles: roles ?? undefined,
      limit,
    });
  }

  const roles = restrictScopeRoles(scope.allRoles, scope.global, step.query?.roles);
  if (roles !== null && roles.length === 0) return null;
  return escalationService.searchByFacets({
    roles: roles ?? undefined,
    facets,
    status,
    available: availability === SCAN_AVAILABILITY.AVAILABLE
      ? true
      : availability === SCAN_AVAILABILITY.CLAIMED ? false : undefined,
    limit,
  });
}

/** Locate for show-detail, show-list, and the confirm phase. */
export async function locateStep(
  step: ScanStep,
  ctx: StepContext,
): Promise<LTApiResult<ScanExecuteResponse> | null> {
  const wantMany = step.verb === SCAN_VERBS.SHOW_LIST
    || step.cardinality === SCAN_CARDINALITY.MANY;
  const result = await locateForStep(step, ctx, wantMany ? 50 : 2);
  if (!result || result.escalations.length === 0) return null;
  const { escalations, total } = result;

  if (step.confirm) {
    const target = escalations[0];
    const interpolated = step.params
      ? scanCodeService.interpolateScanTemplate(step.params, templateContext(ctx))
      : undefined;
    return {
      status: 200,
      data: {
        outcome: SCAN_OUTCOMES.CONFIRM_REQUIRED,
        verb: step.verb,
        escalation: target,
        pendingAction: {
          escalationId: target.id,
          verb: step.verb,
          prompt: step.confirm.prompt,
          params: interpolated,
        },
      },
    };
  }

  if (wantMany) {
    return {
      status: 200,
      data: {
        outcome: SCAN_OUTCOMES.MATCHED_LIST,
        verb: step.verb,
        escalations,
        total,
        listQuery: {
          ...step.query,
          targetFacet: ctx.scheme.target_facet,
          target: ctx.parsed.target,
        },
      },
    };
  }

  return executed(escalations[0], step);
}
