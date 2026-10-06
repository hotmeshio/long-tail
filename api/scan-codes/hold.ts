import * as scanCodeService from '../../services/scan-code';
import {
  SCAN_HOLD_TTL_DEFAULT_SECONDS,
  SCAN_OUTCOMES,
  SCAN_TEMPLATE_TOKENS,
  type LTEscalationRecord,
  type ScanExecuteResponse,
  type ScanHeldSubject,
  type ScanStep,
} from '../../types';
import type { LTApiResult } from '../../types/sdk';
import { templateContext, type StepContext } from './context';
import { locateForStep } from './locate';
import { claimedByOther } from './subject';

/**
 * HOLD: locate the row and hand the station a subject to hold. The next
 * scans (the badge, then the container) act on it. Writes nothing and spends
 * no badge use. A live claim by someone else is reported, not refused: the
 * bench says whose it is, and the act decides.
 */
export async function holdStep(
  step: ScanStep,
  ctx: StepContext,
  located?: LTEscalationRecord,
): Promise<LTApiResult<ScanExecuteResponse> | null> {
  const row = located ?? (await locateForStep(step, ctx, 1))?.escalations[0];
  if (!row) return null;
  return {
    status: 200,
    data: {
      outcome: SCAN_OUTCOMES.HELD,
      verb: step.verb,
      escalation: row,
      subject: await heldSubject(step, ctx, row),
    },
  };
}

async function heldSubject(step: ScanStep, ctx: StepContext, row: LTEscalationRecord): Promise<ScanHeldSubject> {
  const hold = step.params?.hold ?? {};
  const tpl = { ...templateContext(ctx), item: row.metadata ?? {} };
  const ttl = hold.ttlSeconds ?? SCAN_HOLD_TTL_DEFAULT_SECONDS;
  const claimant = await claimedByOther(row, ctx.acting ? ctx.auth.userId : null);
  return {
    code: ctx.rawCode ?? holdCode(ctx),
    escalationId: row.id,
    label: scanCodeService.renderScanCopy(hold.label ?? SCAN_TEMPLATE_TOKENS.TARGET, tpl),
    ...optionalCopy('headline', hold.headline, tpl),
    ...optionalCopy('subline', hold.subline, tpl),
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    ...(hold.expect ? {
      expect: {
        schemes: hold.expect.schemes,
        ...(hold.expect.prompt ? { prompt: scanCodeService.renderScanCopy(hold.expect.prompt, tpl) } : {}),
      },
    } : {}),
    ...(claimant ? { claimedBy: claimant } : {}),
  };
}

/** The canonical code for the held row, as the station would scan it. */
function holdCode(ctx: StepContext): string {
  const { scheme, parsed } = ctx;
  if (scheme.encoding === 'delimited') {
    const d = scheme.delimiter;
    return `${parsed.version}${d}${parsed.category}${d}${parsed.target}`;
  }
  return `${parsed.version}${parsed.category}${parsed.target}`;
}

/** A rendered line, or nothing when the template is absent or renders empty. */
function optionalCopy(
  key: 'headline' | 'subline',
  template: string | undefined,
  tpl: scanCodeService.ScanTemplateContext,
): Partial<Record<'headline' | 'subline', string>> {
  if (!template) return {};
  const text = scanCodeService.renderScanCopy(template, tpl).trim();
  return text ? { [key]: text } : {};
}

