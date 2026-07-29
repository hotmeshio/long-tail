/**
 * x-lt-transition — post-submit hand-off UX. A form_schema may declare, at its
 * schema root, that submitting one of its escalations should pause on a wait
 * screen instead of returning to the previous page — because a follow-on
 * escalation is about to be born assigned to the submitter (a chained hand-off).
 *
 *   x-lt-transition                    boolean  — opt in to the wait screen
 *   x-lt-transition-message            markdown — shown on the wait screen
 *   x-lt-transition-max-wait-seconds   number   — how long to wait for the
 *                                        follow-on before running the fallback
 *                                        query (clamped to a sane range)
 *
 * These tokens control ONLY the UX. Navigation to the follow-on is driven by the
 * engine's born-assigned `claimed` event (assigned_to + parent_id +
 * assigned_at_creation); the schema carries no navigation target and no metadata
 * is used.
 */

export const X_LT_TRANSITION = 'x-lt-transition';
export const X_LT_TRANSITION_MESSAGE = 'x-lt-transition-message';
export const X_LT_TRANSITION_MAX_WAIT_SECONDS = 'x-lt-transition-max-wait-seconds';
export const X_LT_TRANSITION_DONE = 'x-lt-transition-done';

const DEFAULT_MESSAGE = 'Submitted. Preparing your next step…';
const DEFAULT_MAX_WAIT_SECONDS = 30;
const MIN_MAX_WAIT_SECONDS = 5;
const MAX_MAX_WAIT_SECONDS = 300;

export interface TransitionConfig {
  /** Markdown shown on the wait screen. */
  message: string;
  /** Seconds to wait for the follow-on before the fallback query runs. */
  maxWaitSeconds: number;
}

function clampWaitSeconds(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_WAIT_SECONDS;
  return Math.min(MAX_MAX_WAIT_SECONDS, Math.max(MIN_MAX_WAIT_SECONDS, Math.round(n)));
}

/**
 * The schema's transition config, or null when the schema does not opt in.
 * `x-lt-transition` must be truthy; message and max-wait fall back to defaults.
 */
export function readTransitionConfig(
  schema: Record<string, unknown> | null | undefined,
): TransitionConfig | null {
  if (!schema || !schema[X_LT_TRANSITION]) return null;
  const rawMessage = schema[X_LT_TRANSITION_MESSAGE];
  const message =
    typeof rawMessage === 'string' && rawMessage.trim().length > 0 ? rawMessage : DEFAULT_MESSAGE;
  return { message, maxWaitSeconds: clampWaitSeconds(schema[X_LT_TRANSITION_MAX_WAIT_SECONDS]) };
}

/**
 * Where to go when this step ends without a further hand-off — the terminal
 * step of a chain (submitting it), or a transition step whose follow-on never
 * arrives (the wait times out). Independent of `x-lt-transition`, so a terminal
 * form can declare it without opting into the wait screen.
 *
 * The value is an href template using the same `{{domain.path}}` syntax and
 * routing conventions as `x-lt-href` (see LinkWidget): an internal path
 * (`/escalations/available?role=…`) navigates in-app; anything else opens
 * externally. A page reached via a forward transition can't rely on
 * `history.back()`, so this states the destination explicitly. Returns the raw
 * template (interpolate it against the escalation context before navigating),
 * or null when absent.
 */
export function readTransitionDone(
  schema: Record<string, unknown> | null | undefined,
): string | null {
  const raw = schema?.[X_LT_TRANSITION_DONE];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
}
