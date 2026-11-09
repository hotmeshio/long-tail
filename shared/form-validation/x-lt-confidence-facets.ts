/**
 * Review facets: a few low-cardinality metadata keys summarizing how a
 * reviewer treated a model's proposals, stamped onto the row in the same
 * guarded UPDATE that resolves it. Opt in on the schema root with
 * `"x-lt-confidence": { "facets": true }`. Counts cover the fields the form
 * shows for the submitted answer, the same set the legend counts. Values are
 * strings so `metadata @>` filters and analytics projections match exactly.
 */
import { evaluateShowIf, isHiddenField, isHiddenIfEmpty, type ShowIfContext } from './x-lt-show-if';
import { buildFormReview, readConfidenceSpec, summarizeReview } from './x-lt-confidence';

export const REVIEW_FACET_KEYS = {
  OUTCOME: 'review_outcome',
  CHANGED: 'review_changed',
  WORST: 'review_worst',
} as const;

export const REVIEW_OUTCOMES = {
  ACCEPTED: 'accepted',
  CORRECTED: 'corrected',
} as const;

export type ReviewFacets = Partial<Record<(typeof REVIEW_FACET_KEYS)[keyof typeof REVIEW_FACET_KEYS], string>>;

/** The fields the form shows for these values: x-lt-hidden, x-lt-showIf and x-lt-hide-if-empty applied. */
export function visibleFieldKeys(
  formSchema: Record<string, unknown>,
  formValues: Record<string, unknown>,
  ctx: ShowIfContext,
): string[] {
  const props = (formSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
  return Object.keys(props).filter((key) => {
    const def = props[key];
    if (isHiddenField(def)) return false;
    if (!evaluateShowIf(def?.['x-lt-showIf'], ctx)) return false;
    return !isHiddenIfEmpty(def, formValues[key]);
  });
}

/**
 * The review facets for a submitted answer, or null when the schema does not
 * opt in or no shown field carries a proposal or score. `review_worst` is the
 * lowest tranche any shown field fell into, absent when every score cleared.
 */
export function buildReviewFacets(
  formSchema: Record<string, unknown> | null | undefined,
  ctx: ShowIfContext | null | undefined,
  formValues: Record<string, unknown>,
): ReviewFacets | null {
  if (!formSchema) return null;
  const spec = readConfidenceSpec(formSchema);
  if (!spec?.facets) return null;

  const liveCtx: ShowIfContext = { ...(ctx ?? {}), resolver: formValues, input: formValues };
  const review = buildFormReview(spec, formSchema, liveCtx as Record<string, unknown>, formValues);
  const shown = visibleFieldKeys(formSchema, formValues, liveCtx).filter((key) => review[key]);
  if (shown.length === 0) return null;

  const summary = summarizeReview(spec, review, shown);
  const worst = summary.tranches.find((t) => t.fields.length > 0)?.tranche;
  return {
    [REVIEW_FACET_KEYS.OUTCOME]: summary.changed.length > 0 ? REVIEW_OUTCOMES.CORRECTED : REVIEW_OUTCOMES.ACCEPTED,
    [REVIEW_FACET_KEYS.CHANGED]: String(summary.changed.length),
    ...(worst ? { [REVIEW_FACET_KEYS.WORST]: worst.label } : {}),
  };
}
