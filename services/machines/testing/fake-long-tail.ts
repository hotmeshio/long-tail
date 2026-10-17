/**
 * An in-memory Long Tail for the machine gateway: escalation rows with the
 * claim / accumulate / resolve / create verbs, each publishing the lifecycle
 * event Long Tail publishes, plus helpers that play the unit workflow and the
 * people (exit, operator).
 */

import type { Actor, CreateRowInput } from '../gateway/actions';
import { VERB_OUTCOME, type LineEscalations, type VerbResult } from '../gateway/escalations';
import { ROW_TYPE, type HandoffFacets } from '../contracts';
import type { MemoryEscalationFeed } from '../../../lib/machines/transport';
import { until } from './wait';
import type { OpenRowQuery } from '../rows';

export interface FakeRow {
  id: string;
  type: string;
  subtype?: string;
  role: string;
  status: 'pending' | 'resolved' | 'cancelled' | 'expired';
  assigned_to?: string;
  metadata: Record<string, any>;
  items: { itemKey: string; payload: any; actor: Actor }[];
  resolver_payload?: Record<string, any>;
  resolved_by?: string;
}

export interface Call { verb: string; as: Actor; id: string; payload?: any }

export class FakeLongTail implements LineEscalations {
  readonly rows = new Map<string, FakeRow>();
  readonly calls: Call[] = [];
  private seq = 0;

  constructor(private readonly feed: MemoryEscalationFeed) {}

  private emit(row: FakeRow, verb: string, extra: Record<string, any> = {}): void {
    this.feed.emit({
      type: `system.escalation.${row.role}.${row.id}.${verb}`, escalationId: row.id, role: row.role,
      data: { id: row.id, type: row.type, subtype: row.subtype, role: row.role, status: row.status, assigned_to: row.assigned_to, metadata: row.metadata, ...extra },
    });
  }

  private add(input: Omit<FakeRow, 'id' | 'status' | 'items'>): FakeRow {
    const row: FakeRow = { ...input, id: `e${++this.seq}`, status: 'pending', items: [] };
    this.rows.set(row.id, row);
    this.emit(row, 'created');
    return row;
  }

  /** What the unit workflow's conditionalAccumulator does: park a handoff row. */
  park(role: string, facets: HandoffFacets): FakeRow {
    return this.add({ type: ROW_TYPE.HANDOFF, role, metadata: { ...facets } });
  }

  /** Park any row, as a host workflow parks its own. */
  parkRow(input: { type: string; role: string; subtype?: string; metadata: Record<string, any> }): FakeRow {
    return this.add({ ...input, metadata: { ...input.metadata } });
  }

  /** A person resolving a row on the dashboard. */
  personResolves(id: string, payload: Record<string, any>, person = 'person-1'): void {
    const row = this.rows.get(id)!;
    row.status = 'resolved';
    row.resolver_payload = payload;
    row.resolved_by = person;
    this.emit(row, 'resolved', { resolved_by: person });
  }

  /** A person or the workflow cancelling the row. */
  cancel(id: string): void {
    const row = this.rows.get(id)!;
    row.status = 'cancelled';
    this.emit(row, 'cancelled');
  }

  /** The row's timeout firing (conditional `timeout`). */
  expire(id: string): void {
    const row = this.rows.get(id)!;
    row.status = 'expired';
    this.emit(row, 'expired');
  }

  async claim(as: Actor, id: string): Promise<VerbResult> {
    this.calls.push({ verb: 'claim', as, id });
    const row = this.rows.get(id);
    if (!row || row.status !== 'pending') return { outcome: VERB_OUTCOME.ALREADY };
    row.assigned_to = as;
    this.emit(row, 'claimed');
    return { outcome: VERB_OUTCOME.DONE };
  }

  async accumulate(as: Actor, id: string, itemKey: string, payload: Record<string, any>): Promise<VerbResult> {
    this.calls.push({ verb: 'accumulate', as, id, payload: { itemKey, ...payload } });
    const row = this.rows.get(id);
    if (!row || row.status !== 'pending') return { outcome: VERB_OUTCOME.ALREADY };
    if (row.items.some((i) => i.itemKey === itemKey)) return { outcome: VERB_OUTCOME.ALREADY };
    row.items.push({ itemKey, payload, actor: as });
    return { outcome: VERB_OUTCOME.DONE, itemKeys: row.items.map((i) => i.itemKey) };
  }

  async resolve(as: Actor, id: string, payload: Record<string, any>): Promise<VerbResult> {
    this.calls.push({ verb: 'resolve', as, id, payload });
    const row = this.rows.get(id);
    if (!row || row.status !== 'pending') return { outcome: VERB_OUTCOME.ALREADY };
    // Long Tail refuses a resolve by id while someone else holds a live claim (409).
    if (row.assigned_to && row.assigned_to !== as) return { outcome: VERB_OUTCOME.ALREADY, detail: 'claimed by another' };
    row.status = 'resolved';
    row.resolver_payload = payload;
    row.resolved_by = as;
    this.emit(row, 'resolved', { resolved_by: as });
    return { outcome: VERB_OUTCOME.DONE };
  }

  async create(_as: Actor, input: CreateRowInput): Promise<{ id: string }> {
    return { id: this.add({ ...input }).id };
  }

  async itemKeys(id: string): Promise<string[]> {
    return (this.rows.get(id)?.items ?? []).map((i) => i.itemKey);
  }

  async listOpen(query: OpenRowQuery): Promise<Record<string, any>[]> {
    return [...this.rows.values()]
      .filter((r) => r.status === 'pending' && (!query.type || r.type === query.type) && (!query.role || r.role === query.role))
      .map((r) => ({ id: r.id, type: r.type, subtype: r.subtype, role: r.role, status: r.status, metadata: r.metadata }));
  }

  ofType(type: string): FakeRow[] {
    return [...this.rows.values()].filter((r) => r.type === type);
  }

  ended(id: string, ms = 1_000): Promise<FakeRow> {
    return until(() => {
      const row = this.rows.get(id);
      return row && row.status !== 'pending' ? row : undefined;
    }, ms);
  }
}
