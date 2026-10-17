/**
 * The escalation verbs the gateway performs, as an interface so the executor
 * runs the same against Long Tail over HTTP or an in-memory fake. Outcomes
 * the gateway treats as done (the row already ended, or the claim is already
 * held) are not errors: replays and races land there.
 */

import type { OpenRowQuery } from '../rows';
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
  /** The HTTP status behind an `already` or `invalid` outcome. */
  status?: number;
  /** After an accumulate: the item keys the row now holds, when the response carries them. */
  itemKeys?: string[];
}

export interface LineEscalations {
  claim(as: Actor, id: string): Promise<VerbResult>;
  /** `metadata` is merged (shallow) into the row's metadata in the same statement as the item. */
  accumulate(as: Actor, id: string, itemKey: string, payload: Record<string, any>, metadata?: Record<string, any>): Promise<VerbResult>;
  resolve(as: Actor, id: string, payload: Record<string, any>): Promise<VerbResult>;
  create(as: Actor, input: CreateRowInput): Promise<{ id: string }>;
  /** The item keys an accumulator row holds. */
  itemKeys(id: string): Promise<string[]>;
  /** Every pending row matching each given field, oldest first, in the projection escalation events carry. */
  listOpen(query: OpenRowQuery): Promise<Record<string, any>[]>;
}

/** Rows per page when reading open rows back. */
export const OPEN_PAGE = 500;

/** Read every page of `page(offset)`, oldest first, until a short page. */
export async function readAllPages(page: (offset: number) => Promise<Record<string, any>[]>): Promise<Record<string, any>[]> {
  const rows: Record<string, any>[] = [];
  for (let offset = 0; ; offset += OPEN_PAGE) {
    const batch = await page(offset);
    rows.push(...batch);
    if (batch.length < OPEN_PAGE) return rows;
  }
}

/** Map an HTTP status to a verb outcome; anything else is a real failure. */
export function verbOutcomeOf(status: number): VerbOutcome | null {
  if (status >= 200 && status < 300) return VERB_OUTCOME.DONE;
  if (status === 404 || status === 409) return VERB_OUTCOME.ALREADY;
  if (status === 422) return VERB_OUTCOME.INVALID;
  return null;
}
