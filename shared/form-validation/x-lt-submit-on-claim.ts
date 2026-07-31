/**
 * x-lt-submit-on-claim — a one-gesture claim. A form_schema may declare, at its
 * schema root, that claiming one of its escalations should also resolve it in
 * the same gesture, submitting whatever the form currently holds (its seeded
 * defaults). The person clicks Claim once and the work item advances — no
 * second Submit step.
 *
 *   x-lt-submit-on-claim   boolean — opt in to claim-and-submit
 *
 * It is opt-in and defaults off. Pair it with `x-lt-labels` to rename the Claim
 * button ("Claim and Submit") so the single gesture reads honestly. When the
 * seeded defaults fail validation the claim still lands; the page drops into the
 * normal claimed state with the field errors surfaced, so the person finishes
 * the form by hand.
 */

export const X_LT_SUBMIT_ON_CLAIM = 'x-lt-submit-on-claim';

/**
 * Whether the schema opts into claim-and-submit. Truthy `x-lt-submit-on-claim`
 * turns it on; anything else (absent, false) leaves the standard two-step claim
 * then submit.
 */
export function readSubmitOnClaim(
  schema: Record<string, unknown> | null | undefined,
): boolean {
  return !!schema?.[X_LT_SUBMIT_ON_CLAIM];
}
