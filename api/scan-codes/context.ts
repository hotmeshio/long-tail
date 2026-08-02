import * as scanCodeService from '../../services/scan-code';
import {
  SCAN_OUTCOMES,
  SCAN_PROVENANCE_KEYS,
  type LTEscalationRecord,
  type ParsedScanCode,
  type ScanExecuteResponse,
  type ScanRule,
  type ScanScheme,
  type ScanStep,
} from '../../types';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';

/** Everything a step executor needs about the scan that reached it. */
export interface StepContext {
  scheme: ScanScheme;
  rule: ScanRule;
  parsed: ParsedScanCode;
  scannedAt: string;
  /** The effective actor — the acting (badged) user when a grant rode the request. */
  auth: LTApiAuth;
  /** The authenticated principal (the device on a station deployment). */
  stationAuth: LTApiAuth;
  /** True when `auth` came from an acting-identity grant. */
  acting: boolean;
}

export function targetFilter(step: ScanStep, ctx: StepContext): Record<string, any> {
  return { [ctx.scheme.target_facet]: ctx.parsed.target, ...(step.query?.facets ?? {}) };
}

export function templateContext(ctx: StepContext): scanCodeService.ScanTemplateContext {
  return { target: ctx.parsed.target, category: ctx.parsed.category, scannedAt: ctx.scannedAt };
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

export function interpolatedMetadata(step: ScanStep, ctx: StepContext): Record<string, any> {
  return step.params?.metadata
    ? scanCodeService.interpolateScanTemplate(step.params.metadata, templateContext(ctx))
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

export function notPrimed(ctx: StepContext): LTApiResult<ScanExecuteResponse> {
  return {
    status: 200,
    data: {
      outcome: SCAN_OUTCOMES.NOT_PRIMED,
      notPrimed: ctx.rule.notPrimed,
      error: 'an acting identity is required — scan your badge',
    },
  };
}
