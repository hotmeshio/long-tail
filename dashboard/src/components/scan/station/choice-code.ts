import type { ScanPresentedChoice } from '../../../api/scan-codes';

/**
 * Whether a presented choice can act right now. The server withholds choices
 * whose identity requirement was unsatisfied at scan time; a badge primed
 * afterwards satisfies it, so the withholding lifts client-side without a
 * fresh present. A choice the server did not withhold stays enabled.
 */
export function isChoiceEnabled(choice: ScanPresentedChoice, hasActingIdentity: boolean): boolean {
  return !choice.withheld || hasActingIdentity;
}

/**
 * The enabled choice whose double-scan code exactly equals the raw emitted
 * string, or null. Choice codes are short tokens that never parse as scheme
 * codes, so an exact match is unambiguous; anything else falls through to
 * normal scan execution.
 */
export function matchChoiceByCode(
  choices: ScanPresentedChoice[],
  hasActingIdentity: boolean,
  raw: string,
): ScanPresentedChoice | null {
  return (
    choices.find((c) => !!c.code && c.code === raw && isChoiceEnabled(c, hasActingIdentity)) ?? null
  );
}
