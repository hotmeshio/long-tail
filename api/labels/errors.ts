import { LabelRequestError, LabelTemplateConflictError, LabelTemplateValidationError } from '../../services/labels';
import type { LTApiResult } from '../../types/sdk';

/** A refused label request as an API result; anything else is a 500. */
export function labelFailure(err: any): LTApiResult {
  if (err instanceof LabelRequestError) return { status: err.status, error: err.message };
  if (err instanceof LabelTemplateValidationError || err instanceof LabelTemplateConflictError) {
    return { status: err.status, error: err.message };
  }
  if (err?.status === 400 || err?.status === 409) return { status: err.status, error: err.message };
  return { status: 500, error: err?.message ?? 'label request failed' };
}
