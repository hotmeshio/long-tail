/**
 * LineEscalations backed by the escalation API functions in process: the same
 * calls the HTTP routes make, run as the user each actor maps to.
 */

import * as escalationApi from '../../api/escalations';
import type { Actor, CreateRowInput } from '../../examples/workflows/machine-line/gateway/actions';
import { verbOutcomeOf, type LineEscalations, type VerbResult } from '../../examples/workflows/machine-line/gateway/escalations';
import { CONTROLLER } from '../../examples/workflows/machine-line/gateway/actions';
import type { LTApiResult } from '../../types/sdk';

export class ApiLineEscalations implements LineEscalations {
  constructor(private readonly userFor: (as: Actor) => string) {}

  private auth(as: Actor) {
    return { userId: this.userFor(as) };
  }

  private verb(result: LTApiResult): VerbResult {
    const outcome = verbOutcomeOf(result.status);
    if (!outcome) throw new Error(`escalation verb failed ${result.status}: ${result.error}`);
    return { outcome, detail: result.error };
  }

  async claim(as: Actor, id: string): Promise<VerbResult> {
    return this.verb(await escalationApi.claimEscalation({ id, durationMinutes: 60 }, this.auth(as)));
  }

  async accumulate(as: Actor, id: string, itemKey: string, payload: Record<string, any>): Promise<VerbResult> {
    return this.verb(await escalationApi.accumulateItem({ id, itemKey, payload }, this.auth(as)));
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

  async listOpen(type: string): Promise<Record<string, any>[]> {
    const result = await escalationApi.listEscalations({ type, status: 'pending', limit: 500 } as any, this.auth(CONTROLLER));
    if (result.status >= 300) throw new Error(`list failed ${result.status}: ${result.error}`);
    return (result.data as any).escalations;
  }
}
