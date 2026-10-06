import * as scanCodeService from '../../services/scan-code';
import * as escalationService from '../../services/escalation';
import {
  SCAN_OUTCOMES,
  SCAN_PROVENANCE_KEYS,
  isEffectivelyClaimed,
  type LTEscalationRecord,
  type ParsedScanCode,
  type ScanExecuteResponse,
  type ScanRule,
  type ScanScheme,
  type ScanStep,
} from '../../types';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';

/** The held subject, re-derived from the client's pointer on this request. */
export interface HeldSubject {
  row: LTEscalationRecord;
  parsed: ParsedScanCode;
  scheme: ScanScheme;
  code: string;
}

/** The acting grant riding the request, and whether this request spent it. */
export interface GrantLedger {
  token: string;
  /** Before this request touched it. */
  peeked: { remaining: number | null; bound: boolean };
  /** Set once this request spends a use; null until then. */
  spent: { remaining: number | null; bound: boolean } | null;
}

/** Everything a step executor needs about the scan that reached it. */
export interface StepContext {
  scheme: ScanScheme;
  rule: ScanRule;
  parsed: ParsedScanCode;
  /** The code as the station scanned it; absent when a choice re-derived the target. */
  rawCode?: string;
  scannedAt: string;
  /** The effective actor — the acting (badged) user when a grant rode the request. */
  auth: LTApiAuth;
  /** The authenticated principal (the device on a station deployment). */
  stationAuth: LTApiAuth;
  /** True when `auth` came from an acting-identity grant. */
  acting: boolean;
  /** The grant behind `acting`; spent only when an act lands. */
  grant?: GrantLedger;
  /** The subject the station holds, when its pointer still checks out. */
  subject?: HeldSubject;
  /** The station sent a subject pointer that no longer checks out. */
  subjectStale?: boolean;
}

export function targetFilter(step: ScanStep, ctx: StepContext): Record<string, any> {
  return { [ctx.scheme.target_facet]: ctx.parsed.target, ...(step.query?.facets ?? {}) };
}

export function templateContext(ctx: StepContext): scanCodeService.ScanTemplateContext {
  return {
    target: ctx.parsed.target,
    category: ctx.parsed.category,
    scannedAt: ctx.scannedAt,
    code: ctx.parsed.raw ?? ctx.parsed.target,
    ...(ctx.subject ? { subject: subjectBag(ctx.subject.row) } : {}),
  };
}

/** The `{subject.x}` bag: the held row's metadata plus its id. */
export function subjectBag(row: LTEscalationRecord): Record<string, unknown> {
  return { ...(row.metadata ?? {}), id: row.id };
}

/**
 * The metadata of the acting user's single live claim, or undefined when
 * they hold none or more than one. One scoped list query, read before the
 * guarded write; the write re-checks everything under lock.
 */
export async function liveClaimMetadata(ctx: StepContext): Promise<Record<string, unknown> | undefined> {
  const { escalations } = await escalationService.listEscalations({
    assigned_to: ctx.auth.userId,
    status: 'pending',
    limit: 2,
  });
  const live = escalations.filter(isEffectivelyClaimed);
  return live.length === 1 ? (live[0].metadata ?? {}) : undefined;
}

/**
 * The template context for one step: the scan tokens, the located item row's
 * metadata when the verb has one, and the actor's live claim when the step's
 * params mention `{claim.…}` (the lookup costs one query, so it runs only
 * then).
 */
export async function stepTemplate(
  step: ScanStep,
  ctx: StepContext,
  item?: LTEscalationRecord,
): Promise<scanCodeService.ScanTemplateContext> {
  const base = templateContext(ctx);
  const claim = scanCodeService.mentionsClaimToken(step.params) ? await liveClaimMetadata(ctx) : undefined;
  return { ...base, ...(item ? { item: item.metadata ?? {} } : {}), ...(claim ? { claim } : {}) };
}

export function provenance(ctx: StepContext): Record<string, any> {
  return {
    [SCAN_PROVENANCE_KEYS.SCHEME]: ctx.scheme.version,
    [SCAN_PROVENANCE_KEYS.CATEGORY]: ctx.parsed.category,
    [SCAN_PROVENANCE_KEYS.ACTION_NAME]: ctx.rule.name,
    [SCAN_PROVENANCE_KEYS.SCANNED_AT]: ctx.scannedAt,
    // Under an acting identity the mutation attributes to the person; the
    // device where it happened is the other half of the audit pair.
    ...(ctx.acting ? { [SCAN_PROVENANCE_KEYS.STATION]: ctx.stationAuth.userId } : {}),
  };
}

export function interpolatedMetadata(
  step: ScanStep,
  ctx: StepContext,
  tpl: scanCodeService.ScanTemplateContext = templateContext(ctx),
): Record<string, any> {
  return step.params?.metadata
    ? scanCodeService.interpolateScanTemplate(step.params.metadata, tpl)
    : {};
}

export function executed(
  escalation: LTEscalationRecord | Record<string, any> | undefined,
  step: Pick<ScanStep, 'verb'>,
): LTApiResult<ScanExecuteResponse> {
  return { status: 200, data: { outcome: SCAN_OUTCOMES.EXECUTED, verb: step.verb, escalation } };
}

export function forbidden(error?: string): LTApiResult<ScanExecuteResponse> {
  return { status: 200, data: { outcome: SCAN_OUTCOMES.FORBIDDEN, error } };
}

export function conflict(error?: string): LTApiResult<ScanExecuteResponse> {
  return { status: 200, data: { outcome: SCAN_OUTCOMES.CONFLICT, error } };
}

export function notPrimed(ctx: StepContext, error?: string): LTApiResult<ScanExecuteResponse> {
  return {
    status: 200,
    data: {
      outcome: SCAN_OUTCOMES.NOT_PRIMED,
      notPrimed: ctx.rule.notPrimed,
      replayable: true,
      error: error ?? 'an acting identity is required — scan your badge',
    },
  };
}

/** Nothing was written; say why, and name what the step expected. */
export function refused(
  markdown: string,
  extra: Partial<ScanExecuteResponse> = {},
): LTApiResult<ScanExecuteResponse> {
  return {
    status: 200,
    data: { outcome: SCAN_OUTCOMES.REFUSED, refusal: { markdown }, error: markdown, ...extra },
  };
}

/**
 * Interpolates a step's params, or falls through when a `{claim.…}` or
 * `{item.…}` token has nothing to read: a literal token never reaches a row.
 */
export async function templated<T>(
  step: ScanStep,
  ctx: StepContext,
  render: (tpl: scanCodeService.ScanTemplateContext) => T,
  item?: LTEscalationRecord,
): Promise<T | null> {
  const tpl = await stepTemplate(step, ctx, item);
  try {
    return render(tpl);
  } catch (err) {
    if (err instanceof scanCodeService.ScanTemplateError) return null;
    throw err;
  }
}

/**
 * Attach the step's `done` copy to a write that landed. `tpl` carries the
 * bags the copy may read (the container a subject step located, a fill's
 * batch); an unreadable token renders empty rather than failing the act.
 */
export function withDone(
  result: LTApiResult<ScanExecuteResponse>,
  step: ScanStep,
  tpl: scanCodeService.ScanTemplateContext,
): LTApiResult<ScanExecuteResponse> {
  const data = result.data;
  if (!step.done || !data || data.outcome !== SCAN_OUTCOMES.EXECUTED || data.already || data.done) return result;
  return { ...result, data: { ...data, done: { markdown: scanCodeService.renderScanCopy(step.done.markdown, tpl) } } };
}

