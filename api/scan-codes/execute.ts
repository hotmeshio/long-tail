import * as scanCodeService from '../../services/scan-code';
import * as escalationService from '../../services/escalation';
import { claimByMetadata, resolveByMetadata, restrictScopeRoles } from '../escalations/metadata';
import { createEscalation } from '../escalations/create';
import { releaseEscalation } from '../escalations/claim';
import { getEscalationReadScope, getEscalationWriteScope } from '../escalations/helpers';
import {
  SCAN_AVAILABILITY,
  SCAN_CARDINALITY,
  SCAN_OUTCOMES,
  SCAN_PROVENANCE_KEYS,
  SCAN_VERBS,
  type LTEscalationRecord,
  type ParsedScanCode,
  type ScanExecuteRequest,
  type ScanExecuteResponse,
  type ScanRule,
  type ScanScheme,
  type ScanStep,
} from '../../types';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';

interface StepContext {
  scheme: ScanScheme;
  rule: ScanRule;
  parsed: ParsedScanCode;
  scannedAt: string;
  auth: LTApiAuth;
}

/**
 * Execute a raw scan code: parse → load the rule → walk its steps in order.
 * The first step whose condition matches performs its verb and answers; a
 * step that matches nothing falls through to the next. Every terminal state
 * is a structured 200 outcome — the scan surface reports, it doesn't throw.
 */
export async function executeScanCode(
  input: ScanExecuteRequest,
  auth: LTApiAuth,
): Promise<LTApiResult<ScanExecuteResponse>> {
  try {
    if (!input.code || typeof input.code !== 'string') {
      return { status: 400, error: 'code is required' };
    }

    // 1. Parse against the configured schemes
    const schemes = await scanCodeService.listScanSchemes();
    const parseResult = scanCodeService.parseScanCode(input.code, schemes);
    if (!parseResult.ok) {
      const { reason, detail } = parseResult.failure;
      const outcome = reason === 'unknown_version' || reason === 'scheme_disabled'
        ? SCAN_OUTCOMES.UNCONFIGURED
        : SCAN_OUTCOMES.INVALID_CODE;
      return { status: 200, data: { outcome, error: detail } };
    }
    const { parsed, scheme } = parseResult;

    // 2. Load the rule for this category
    const rule = await scanCodeService.getScanRule(parsed.version, parsed.category);
    if (!rule || !rule.enabled) {
      return {
        status: 200,
        data: {
          outcome: SCAN_OUTCOMES.UNCONFIGURED,
          parsed,
          error: `no scan rule configured for ${parsed.version}:${parsed.category}`,
        },
      };
    }

    // 3. Walk the steps — first condition match wins
    const ctx: StepContext = {
      scheme, rule, parsed, scannedAt: new Date().toISOString(), auth,
    };
    for (let i = 0; i < rule.steps.length; i++) {
      const result = await executeStep(rule.steps[i], i, ctx);
      if (result) return decorate(result, ctx, i);
    }

    // 4. Nothing matched — the fallback screen is the answer
    return {
      status: 200,
      data: decorateData({ outcome: SCAN_OUTCOMES.NO_MATCH_FALLBACK, fallback: rule.fallback }, ctx),
    };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/** Stamp rule identity + parsed code onto a step result. */
function decorate(
  result: LTApiResult<ScanExecuteResponse>,
  ctx: StepContext,
  stepIndex: number,
): LTApiResult<ScanExecuteResponse> {
  if (result.data && typeof result.data === 'object' && 'outcome' in result.data) {
    result.data = { ...decorateData(result.data, ctx), stepIndex };
  }
  return result;
}

function decorateData(data: ScanExecuteResponse, ctx: StepContext): ScanExecuteResponse {
  return {
    ...data,
    parsed: ctx.parsed,
    rule: {
      schemeVersion: ctx.rule.scheme_version,
      category: ctx.rule.category,
      name: ctx.rule.name,
    },
  };
}

/**
 * Execute one step. Returns null when the step's condition matched nothing
 * (fall through) and an LTApiResult for every terminal outcome.
 */
async function executeStep(
  step: ScanStep,
  index: number,
  ctx: StepContext,
): Promise<LTApiResult<ScanExecuteResponse> | null> {
  // Confirm steps and read verbs only locate — mutation happens after the
  // user confirms, through the standard per-id endpoints.
  if (step.confirm || step.verb === SCAN_VERBS.SHOW_DETAIL || step.verb === SCAN_VERBS.SHOW_LIST) {
    return locateStep(step, ctx);
  }
  switch (step.verb) {
    case SCAN_VERBS.CLAIM:
    case SCAN_VERBS.CLAIM_SHOW_DETAIL:
      return claimStep(step, ctx);
    case SCAN_VERBS.RESOLVE:
      return resolveStep(step, ctx);
    case SCAN_VERBS.ESCALATE:
      return escalateStep(step, ctx);
    case SCAN_VERBS.RELEASE:
      return releaseStep(step, ctx);
    case SCAN_VERBS.CANCEL:
      return cancelStep(step, ctx);
    default:
      throw new Error(`unknown scan verb "${step.verb}"`);
  }
}

// ── Shared pieces ──────────────────────────────────────────────────────────

function targetFilter(step: ScanStep, ctx: StepContext): Record<string, any> {
  return { [ctx.scheme.target_facet]: ctx.parsed.target, ...(step.query?.facets ?? {}) };
}

function templateContext(ctx: StepContext): scanCodeService.ScanTemplateContext {
  return { target: ctx.parsed.target, category: ctx.parsed.category, scannedAt: ctx.scannedAt };
}

function provenance(ctx: StepContext): Record<string, any> {
  return {
    [SCAN_PROVENANCE_KEYS.SCHEME]: ctx.scheme.version,
    [SCAN_PROVENANCE_KEYS.CATEGORY]: ctx.parsed.category,
    [SCAN_PROVENANCE_KEYS.ACTION_NAME]: ctx.rule.name,
    [SCAN_PROVENANCE_KEYS.SCANNED_AT]: ctx.scannedAt,
  };
}

function executed(escalation: LTEscalationRecord | Record<string, any>, step: ScanStep): LTApiResult<ScanExecuteResponse> {
  return { status: 200, data: { outcome: SCAN_OUTCOMES.EXECUTED, verb: step.verb, escalation } };
}

// ── Locate (show-detail, show-list, confirm phase 1) ───────────────────────

async function locateStep(
  step: ScanStep,
  ctx: StepContext,
): Promise<LTApiResult<ScanExecuteResponse> | null> {
  const scope = await getEscalationReadScope(ctx.auth.userId);
  const availability = step.query?.availability ?? SCAN_AVAILABILITY.ANY;
  const status: 'pending' | 'resolved' | 'cancelled' = step.query?.status ?? 'pending';
  const wantMany = step.verb === SCAN_VERBS.SHOW_LIST
    || step.cardinality === SCAN_CARDINALITY.MANY;
  const limit = wantMany ? 50 : 2;
  const facets = targetFilter(step, ctx);

  let escalations: LTEscalationRecord[];
  let total: number;
  if (availability === SCAN_AVAILABILITY.MINE) {
    // "mine" = assigned to the caller; self-scope roles qualify because the
    // assigned_to predicate satisfies their visibility branch.
    const readable = [...scope.allRoles, ...scope.selfRoles];
    const roles = restrictScopeRoles(readable, scope.global, step.query?.roles);
    if (roles !== null && roles.length === 0) return null;
    const result = await escalationService.listEscalations({
      metadata: facets,
      status,
      assigned_to: ctx.auth.userId,
      visibleRoles: roles ?? undefined,
      limit,
    });
    escalations = result.escalations;
    total = result.total;
  } else {
    const roles = restrictScopeRoles(scope.allRoles, scope.global, step.query?.roles);
    if (roles !== null && roles.length === 0) return null;
    const result = await escalationService.searchByFacets({
      roles: roles ?? undefined,
      facets,
      status,
      available: availability === SCAN_AVAILABILITY.AVAILABLE
        ? true
        : availability === SCAN_AVAILABILITY.CLAIMED ? false : undefined,
      limit,
    });
    escalations = result.escalations;
    total = result.total;
  }

  if (escalations.length === 0) return null;

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

// ── Mutating verbs — each a single atomic operation under the caller's RBAC ─

async function claimStep(
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

async function resolveStep(
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

async function escalateStep(
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

async function releaseStep(
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

async function cancelStep(
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

// ── Small result helpers ───────────────────────────────────────────────────

function interpolatedMetadata(step: ScanStep, ctx: StepContext): Record<string, any> {
  return step.params?.metadata
    ? scanCodeService.interpolateScanTemplate(step.params.metadata, templateContext(ctx))
    : {};
}

function forbidden(error?: string): LTApiResult<ScanExecuteResponse> {
  return { status: 200, data: { outcome: SCAN_OUTCOMES.FORBIDDEN, error } };
}

function conflict(error?: string): LTApiResult<ScanExecuteResponse> {
  return { status: 200, data: { outcome: SCAN_OUTCOMES.CONFLICT, error } };
}
