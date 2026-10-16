/**
 * The escalation verbs the gateway performs, as an interface so the executor
 * runs the same against Long Tail over HTTP or an in-memory fake. Outcomes
 * the gateway treats as done (the row already ended, or the claim is already
 * held) are not errors: replays and races land there.
 */

import type { Actor, CreateRowInput } from './actions';

export const VERB_OUTCOME = {
  DONE: 'done',
  /** 404, or 409 because the row already ended: nothing left to do. */
  ALREADY: 'already',
  /** 422: the payload does not satisfy the role's form schema. */
  INVALID: 'invalid',
} as const;
export type VerbOutcome = typeof VERB_OUTCOME[keyof typeof VERB_OUTCOME];

export interface VerbResult {
  outcome: VerbOutcome;
  detail?: string;
}

export interface LineEscalations {
  claim(as: Actor, id: string): Promise<VerbResult>;
  accumulate(as: Actor, id: string, itemKey: string, payload: Record<string, any>): Promise<VerbResult>;
  resolve(as: Actor, id: string, payload: Record<string, any>): Promise<VerbResult>;
  create(as: Actor, input: CreateRowInput): Promise<{ id: string }>;
  /** Open rows of a type, in the projection escalation events carry. */
  listOpen(type: string): Promise<Record<string, any>[]>;
}

/** Map an HTTP status to a verb outcome; anything else is a real failure. */
export function verbOutcomeOf(status: number): VerbOutcome | null {
  if (status >= 200 && status < 300) return VERB_OUTCOME.DONE;
  if (status === 404 || status === 409) return VERB_OUTCOME.ALREADY;
  if (status === 422) return VERB_OUTCOME.INVALID;
  return null;
}
