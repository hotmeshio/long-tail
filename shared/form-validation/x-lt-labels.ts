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
 * `cancel` additionally accepts `false` to remove the control entirely —
 * for roles where cancelling is not part of the process ("Send to Service"
 * flows escalate instead). The other targets are rename-only: hiding
 * claim/submit/release would strand the footer.
 *
 * Only the five known targets are read; unknown keys and non-string values
 * (except `cancel: false`) are ignored. Any target the schema omits keeps its
 * default label, so a schema overrides just the controls it cares about.
 */

export const X_LT_LABELS = 'x-lt-labels';

/** The footer controls a schema may rename. */
export const FOOTER_LABEL_TARGETS = ['claim', 'cancel', 'submit', 'escalate', 'release'] as const;

export type FooterLabelTarget = (typeof FOOTER_LABEL_TARGETS)[number];

/**
 * A partial map of target → override label. Absent targets keep their
 * default. `cancel: false` removes the cancel control from the footer.
 */
export type FooterLabels = Partial<Record<Exclude<FooterLabelTarget, 'cancel'>, string>> & {
  cancel?: string | false;
};

/**
 * The schema's footer label overrides, or an empty map when none are declared.
 * Reads only the known targets; a non-object `x-lt-labels`, unknown keys, and
 * blank or non-string values are dropped — except `cancel: false`, which is
 * preserved as the hide instruction.
 */
export function readFooterLabels(
  schema: Record<string, unknown> | null | undefined,
): FooterLabels {
  const raw = schema?.[X_LT_LABELS];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const labels: FooterLabels = {};
  if (source.cancel === false) labels.cancel = false;
  for (const target of FOOTER_LABEL_TARGETS) {
    const value = source[target];
    if (typeof value === 'string' && value.trim().length > 0) {
      labels[target] = value.trim();
    }
  }
  return labels;
}
