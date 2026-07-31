/**
 * x-lt-labels — configurable copy for the standard escalation footer. A
 * form_schema may declare, at its schema root, an object that renames the
 * footer's action controls. Each key is a standard target; its value is the
 * label to render in place of the default.
 *
 *   x-lt-labels   object — { claim, cancel, submit, escalate, release }
 *
 * ```jsonc
 * { "x-lt-labels": { "claim": "Claim and Submit", "submit": "Approve" } }
 * ```
 *
 * Only the five known targets are read; unknown keys and non-string values are
 * ignored. Any target the schema omits keeps its default label, so a schema
 * overrides just the controls it cares about.
 */

export const X_LT_LABELS = 'x-lt-labels';

/** The footer controls a schema may rename. */
export const FOOTER_LABEL_TARGETS = ['claim', 'cancel', 'submit', 'escalate', 'release'] as const;

export type FooterLabelTarget = (typeof FOOTER_LABEL_TARGETS)[number];

/** A partial map of target → override label. Absent targets keep their default. */
export type FooterLabels = Partial<Record<FooterLabelTarget, string>>;

/**
 * The schema's footer label overrides, or an empty map when none are declared.
 * Reads only the known targets; a non-object `x-lt-labels`, unknown keys, and
 * blank or non-string values are dropped.
 */
export function readFooterLabels(
  schema: Record<string, unknown> | null | undefined,
): FooterLabels {
  const raw = schema?.[X_LT_LABELS];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const labels: FooterLabels = {};
  for (const target of FOOTER_LABEL_TARGETS) {
    const value = source[target];
    if (typeof value === 'string' && value.trim().length > 0) {
      labels[target] = value.trim();
    }
  }
  return labels;
}
