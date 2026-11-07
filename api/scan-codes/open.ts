import * as escalationService from '../../services/escalation';
import {
  SCAN_OUTCOMES,
  type LTEscalationRecord,
  type ScanExecuteResponse,
  type ScanOpen,
  type ScanOpenLink,
  type ScanStep,
} from '../../types';
import type { LTApiResult } from '../../types/sdk';
import type { StepContext } from './context';

const OPEN_LABEL_DEFAULT = 'Open';

type FacetValue = string | number | boolean;

/** The answers the station shows on its own screen: a hold, a refusal, a write's done copy. */
function screenOf(data: ScanExecuteResponse): 'hold' | 'screen' | null {
  if (data.outcome === SCAN_OUTCOMES.HELD && data.subject) return 'hold';
  if (data.outcome === SCAN_OUTCOMES.REFUSED) return 'screen';
  if (data.outcome === SCAN_OUTCOMES.EXECUTED
    && (data.done || data.clearSubject || data.progress || data.already)) return 'screen';
  return null;
}

/**
 * Attach the step's Open button to the answer: on the held subject for a
 * hold, so it stays while the row is held, else on the response. A target
 * with no row, or a list facet the row does not carry, offers no button.
 */
export async function withOpen(
  result: LTApiResult<ScanExecuteResponse>,
  step: Pick<ScanStep, 'open'>,
  ctx: StepContext,
): Promise<LTApiResult<ScanExecuteResponse>> {
  const data = result.data;
  if (!step.open || !data) return result;
  const screen = screenOf(data);
  if (!screen) return result;
  const link = await resolveOpen(step.open, ctx, data);
  if (!link) return result;
  if (screen === 'hold') return { ...result, data: { ...data, subject: { ...data.subject!, open: link } } };
  return { ...result, data: { ...data, open: link } };
}

async function resolveOpen(open: ScanOpen, ctx: StepContext, data: ScanExecuteResponse): Promise<ScanOpenLink | null> {
  const row = await targetRow(open, ctx, data);
  if (!row) return null;
  const label = open.label ?? OPEN_LABEL_DEFAULT;
  if (!open.list) return { label, escalationId: row.id, ...(open.claim ? { claim: true } : {}) };
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const facets: Record<string, FacetValue> = {};
  for (const key of open.list.facets) {
    const value = meta[key];
    if (!['string', 'number', 'boolean'].includes(typeof value) || value === '') return null;
    facets[key] = value as FacetValue;
  }
  return { label, facets, ...(open.list.role ? { role: open.list.role } : {}) };
}

/** The row the button opens: the one the step answered with, the held subject, or the scanned code's own row. */
async function targetRow(open: ScanOpen, ctx: StepContext, data: ScanExecuteResponse): Promise<LTEscalationRecord | null> {
  const answered = data.escalation as Partial<LTEscalationRecord> | undefined;
  if (open.target === 'located') return ctx.located ?? null;
  if (open.target === 'subject' && data.outcome !== SCAN_OUTCOMES.HELD) return ctx.subject?.row ?? null;
  if (!answered?.id) return null;
  if (!open.list || answered.metadata) return answered as LTEscalationRecord;
  return escalationService.getEscalation(String(answered.id));
}
