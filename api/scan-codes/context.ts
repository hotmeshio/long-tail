import * as scanCodeService from '../../services/scan-code';
import * as escalationService from '../../services/escalation';
import {
  SCAN_FOLLOW_WAIT_DEFAULT_SECONDS,
  SCAN_OUTCOMES,
  SCAN_PROVENANCE_KEYS,
  SCAN_TARGET_MATCH,
  isEffectivelyClaimed,
  type LTEscalationRecord,
  type ParsedScanCode,
  type ScanDoneCopy,
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
  /** The scanned code's own pending row, read once a step's copy or Open asks for it; null when none. */
  located?: LTEscalationRecord | null;
  /** The located row's role title. */
  locatedTitle?: string | null;
}

export function targetFilter(step: ScanStep, ctx: StepContext): Record<string, any> {
  return { [ctx.scheme.target_facet]: targetValue(ctx), ...(step.query?.facets ?? {}) };
}

/**
 * The value the target facet contains on a matching row: the target, or a
 * one-item list when the scheme's facet holds a list (`metadata @>` then
 * matches membership).
 */
export function targetValue(ctx: Pick<StepContext, 'scheme' | 'parsed'>): string | string[] {
  return ctx.scheme.target_match === SCAN_TARGET_MATCH.MEMBER ? [ctx.parsed.target] : ctx.parsed.target;
}

export function templateContext(ctx: StepContext): scanCodeService.ScanTemplateContext {
  return {
    target: ctx.parsed.target,
    category: ctx.parsed.category,
    scannedAt: ctx.scannedAt,
    code: ctx.parsed.raw ?? ctx.parsed.target,
    ...(ctx.subject ? { subject: subjectBag(ctx.subject.row) } : {}),
    ...(ctx.located ? { located: locatedBag(ctx.located, ctx.locatedTitle) } : {}),
  };
}

/** The `{located.x}` bag: the row's metadata plus its id, role and role title. */
export function locatedBag(row: LTEscalationRecord, title?: string | null): Record<string, unknown> {
  return { ...(row.metadata ?? {}), id: row.id, role: row.role, roleTitle: title || row.role };
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
  step: Pick<ScanStep, 'done'>,
  tpl: scanCodeService.ScanTemplateContext,
): LTApiResult<ScanExecuteResponse> {
  const data = result.data;
  if (!step.done || !data || data.outcome !== SCAN_OUTCOMES.EXECUTED || data.already || data.done) return result;
  return { ...result, data: { ...data, done: renderDone(step.done, tpl) } };
}

/** A done copy rendered for the station: the markdown, its pause, and the line under it. */
export function renderDone(done: ScanDoneCopy, tpl: scanCodeService.ScanTemplateContext): ScanDoneCopy {
  return {
    markdown: scanCodeService.renderScanCopy(done.markdown, tpl),
    ...(done.afterSeconds !== undefined ? { afterSeconds: done.afterSeconds } : {}),
    ...(done.nextPrompt ? { nextPrompt: scanCodeService.renderScanCopy(done.nextPrompt, tpl) } : {}),
  };
}

/**
 * Attach the step's `follow` to a write that completed the held subject: the
 * code the station replays and the target it waits for, so the subject's
 * next row is held without scanning it again.
 */
export function withFollow(
  result: LTApiResult<ScanExecuteResponse>,
  step: Pick<ScanStep, 'follow'>,
  ctx: StepContext,
): LTApiResult<ScanExecuteResponse> {
  const data = result.data;
  const subject = ctx.subject;
  if (!step.follow || !subject || !data || data.outcome !== SCAN_OUTCOMES.EXECUTED || !data.clearSubject) return result;
  return {
    ...result,
    data: {
      ...data,
      follow: {
        code: subject.code,
        roles: step.follow.roles,
        waitSeconds: step.follow.waitSeconds ?? SCAN_FOLLOW_WAIT_DEFAULT_SECONDS,
        target: { facet: subject.scheme.target_facet, value: subject.parsed.target },
      },
    },
  };
}

