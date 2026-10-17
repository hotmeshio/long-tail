/**
 * LineEscalations backed by the escalation API functions in process: the same
 * calls the HTTP routes make, run as the user each actor maps to.
 */

import * as escalationApi from '../../../api/escalations';
import type { Actor, CreateRowInput } from './actions';
import { OPEN_PAGE, VERB_OUTCOME, readAllPages, verbOutcomeOf, type LineEscalations, type VerbResult } from './escalations';
import { CONTROLLER } from './actions';
import type { LTApiResult } from '../../../types/sdk';
import type { OpenRowQuery } from '../rows';

export class ApiLineEscalations implements LineEscalations {
  constructor(private readonly userFor: (as: Actor) => string) {}

  private auth(as: Actor) {
    return { userId: this.userFor(as) };
  }

  private verb(result: LTApiResult): VerbResult {
    const outcome = verbOutcomeOf(result.status);
    if (!outcome) throw new Error(`escalation verb failed ${result.status}: ${result.error}`);
    return outcome === VERB_OUTCOME.DONE ? { outcome } : { outcome, detail: result.error, status: result.status };
  }

  async claim(as: Actor, id: string): Promise<VerbResult> {
    return this.verb(await escalationApi.claimEscalation({ id, durationMinutes: 60 }, this.auth(as)));
  }

  async accumulate(as: Actor, id: string, itemKey: string, payload: Record<string, any>, metadata?: Record<string, any>): Promise<VerbResult> {
    return this.verb(await escalationApi.accumulateItem({ id, itemKey, payload, ...(metadata ? { metadata } : {}) }, this.auth(as)));
  }

  async resolve(as: Actor, id: string, payload: Record<string, any>): Promise<VerbResult> {
    return this.verb(await escalationApi.resolveEscalation({ id, resolverPayload: payload }, this.auth(as)));
  }

  async create(as: Actor, input: CreateRowInput): Promise<{ id: string }> {
    const result = await escalationApi.createEscalation({ ...input }, this.auth(as));
    if (result.status >= 300) throw new Error(`create failed ${result.status}: ${result.error}`);
    return { id: (result.data as any).id };
  }

  async itemKeys(id: string): Promise<string[]> {
    const result = await escalationApi.getEscalationItems({ id }, this.auth(CONTROLLER));
    if (result.status >= 300) throw new Error(`items failed ${result.status}: ${result.error}`);
    return (result.data as any).items.map((i: any) => i.itemKey);
  }

  async listOpen(query: OpenRowQuery): Promise<Record<string, any>[]> {
    return readAllPages(async (offset) => {
      const result = await escalationApi.listEscalations(
        { ...query, status: 'pending', limit: OPEN_PAGE, offset, sort_by: 'created_at', order: 'asc' }, this.auth(CONTROLLER),
      );
      if (result.status >= 300) throw new Error(`list failed ${result.status}: ${result.error}`);
      return (result.data as any).escalations;
    });
  }
}
