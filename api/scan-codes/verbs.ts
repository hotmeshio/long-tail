import * as scanCodeService from '../../services/scan-code';
import * as escalationService from '../../services/escalation';
import { claimByMetadata, resolveByMetadata, restrictScopeRoles } from '../escalations/metadata';
import { createEscalation } from '../escalations/create';
import { releaseEscalation } from '../escalations/claim';
import { getEscalationReadScope, getEscalationWriteScope } from '../escalations/helpers';
import {
  SCAN_OUTCOMES,
  SCAN_VERBS,
  type ScanExecuteResponse,
  type ScanStep,
} from '../../types';
import type { LTApiResult } from '../../types/sdk';
import {
  conflict,
  executed,
  forbidden,
  interpolatedMetadata,
  provenance,
  targetFilter,
  templateContext,
  type StepContext,
} from './context';

// ── Mutating verbs — each a single atomic operation under the ACTOR's RBAC ──
// ctx.auth is the effective actor: the badged person when a grant rode the
// request, otherwise the authenticated principal. Attribution and write
// scoping both derive from it, live, inside the escalation APIs.

export async function claimStep(
  step: ScanStep,
  ctx: StepContext,
): Promise<LTApiResult<ScanExecuteResponse> | null> {
  const result = await claimByMetadata({
    key: ctx.scheme.target_facet,
    value: ctx.parsed.target,
    durationMinutes: step.params?.durationMinutes,
    metadata: { ...interpolatedMetadata(step, ctx), ...provenance(ctx) },
    restrictRoles: step.query?.roles,
  }, ctx.auth);
  if (result.status === 404) return null;
  if (result.status === 403) return forbidden(result.error);
  if (result.status !== 200) return result;
  return executed(result.data.escalation, step);
}

export async function resolveStep(
  step: ScanStep,
  ctx: StepContext,
): Promise<LTApiResult<ScanExecuteResponse> | null> {
  const result = await resolveByMetadata({
    key: ctx.scheme.target_facet,
    value: ctx.parsed.target,
    resolverPayload: scanCodeService.interpolateScanTemplate(
      step.params?.resolverPayload ?? {}, templateContext(ctx),
    ),
    metadata: { ...interpolatedMetadata(step, ctx), ...provenance(ctx) },
    restrictRoles: step.query?.roles,
    extraFacets: step.query?.facets,
  }, ctx.auth);
  if (result.status === 404) return null;
  if (result.status === 403) return forbidden(result.error);
  if (result.status === 409) return conflict(result.error);
  if (result.status !== 200) return result;
  const escalation = result.data.escalation
    ?? (result.data.escalationId ? { id: result.data.escalationId } : undefined);
  return executed(escalation, step);
}

export async function escalateStep(
  step: ScanStep,
  ctx: StepContext,
): Promise<LTApiResult<ScanExecuteResponse> | null> {
  // Close the located escalation first when configured — the close doubles as
  // the condition check AND the double-scan guard (second scan finds nothing
  // to close and falls through).
  if (step.params?.closeCurrent === 'resolve') {
    const closed = await resolveStep({ ...step, params: { ...step.params, resolverPayload: step.params?.resolverPayload ?? {} } }, ctx);
    if (closed === null) return null;
    if (closed.data?.outcome !== SCAN_OUTCOMES.EXECUTED) return closed;
  } else if (step.params?.closeCurrent === 'cancel') {
    const cancelled = await cancelStep(step, ctx);
    if (cancelled === null) return null;
    if (cancelled.data?.outcome !== SCAN_OUTCOMES.EXECUTED) return cancelled;
  }

  const created = await createEscalation({
    type: step.params?.escalationType ?? 'scan',
    role: step.params!.targetRole!,
    description: step.params?.description ?? ctx.rule.name,
    metadata: {
      [ctx.scheme.target_facet]: ctx.parsed.target,
      ...interpolatedMetadata(step, ctx),
      ...provenance(ctx),
    },
  }, ctx.auth);
  if (created.status === 403) return forbidden(created.error);
  if (created.status !== 201) return created;
  return executed(created.data, step);
}

export async function releaseStep(
  step: ScanStep,
  ctx: StepContext,
): Promise<LTApiResult<ScanExecuteResponse> | null> {
  // Locate the caller's own claim; release-by-id re-asserts the assignee
  // inside the SDK, so a lost race resolves to 409, never a foreign release.
  const scope = await getEscalationReadScope(ctx.auth.userId);
  const readable = [...scope.allRoles, ...scope.selfRoles];
  const roles = restrictScopeRoles(readable, scope.global, step.query?.roles);
  if (roles !== null && roles.length === 0) return null;
  const { escalations } = await escalationService.listEscalations({
    metadata: targetFilter(step, ctx),
    status: 'pending',
    assigned_to: ctx.auth.userId,
    visibleRoles: roles ?? undefined,
    limit: 1,
  });
  if (escalations.length === 0) return null;
  const result = await releaseEscalation({ id: escalations[0].id }, ctx.auth);
  if (result.status === 403) return forbidden(result.error);
  if (result.status === 409) return conflict(result.error);
  if (result.status !== 200) return result;
  return executed(result.data.escalation, step);
}

/**
 * Dispatch one CHOICE verb against an already-presented row. Unlike the step
 * walk (where a miss falls through to the next step), the screen showed this
 * exact row — so a miss answers with the truth: FORBIDDEN when the actor
 * holds no write scope here, CONFLICT when a concurrent actor won the race.
 */
export async function dispatchChoiceVerb(
  step: ScanStep,
  ctx: StepContext,
  row: Record<string, any>,
): Promise<LTApiResult<ScanExecuteResponse>> {
  switch (step.verb) {
    case SCAN_VERBS.SHOW_DETAIL:
      return executed(row, step); // already located under the actor's scope
    case SCAN_VERBS.CLAIM:
    case SCAN_VERBS.CLAIM_SHOW_DETAIL:
      return (await claimStep(step, ctx)) ?? (await missReason(step, ctx, 'the item is no longer claimable'));
    case SCAN_VERBS.RESOLVE:
      return (await resolveStep(step, ctx)) ?? (await missReason(step, ctx, 'the item is no longer resolvable'));
    case SCAN_VERBS.ESCALATE:
      return (await escalateStep(step, ctx)) ?? (await missReason(step, ctx, 'the item already moved on'));
    case SCAN_VERBS.RELEASE:
      return (await releaseStep(step, ctx)) ?? conflict('no claim of yours to release');
    case SCAN_VERBS.CANCEL:
      return (await cancelStep(step, ctx)) ?? (await missReason(step, ctx, 'the item is no longer cancellable'));
    default:
      throw new Error(`unknown choice verb "${step.verb}"`);
  }
}

async function missReason(
  step: ScanStep,
  ctx: StepContext,
  raceMessage: string,
): Promise<LTApiResult<ScanExecuteResponse>> {
  const scope = await getEscalationWriteScope(ctx.auth.userId);
  if (!scope.global) {
    const roles = restrictScopeRoles(scope.allRoles, scope.global, step.query?.roles);
    if (roles !== null && roles.length === 0) {
      return forbidden('your roles do not permit acting on this queue');
    }
  }
  return conflict(raceMessage);
}

export async function cancelStep(
  step: ScanStep,
  ctx: StepContext,
): Promise<LTApiResult<ScanExecuteResponse> | null> {
  // Claim-as-lock: the atomic claim pins the row to this caller (or extends
  // their claim), serializing concurrent double-scans before the cancel.
  const claimed = await claimByMetadata({
    key: ctx.scheme.target_facet,
    value: ctx.parsed.target,
    metadata: provenance(ctx),
    restrictRoles: step.query?.roles,
  }, ctx.auth);
  if (claimed.status === 404) return null;
  if (claimed.status === 403) return forbidden(claimed.error);
  if (claimed.status !== 200) return claimed;

  const cancelled = await escalationService.cancelEscalation(claimed.data.escalation.id);
  if (!cancelled) return conflict('Escalation is not cancellable (already terminal)');
  return executed(cancelled, step);
}
