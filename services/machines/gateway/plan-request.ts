/**
 * Machine requests (requests.ts): a decoded message the codec marks `answer`
 * parks one row; the row's events tell the gateway when an answer is there to
 * send and when the request has ended. Answering is the dispatcher's.
 */

import { DECISION } from '../contracts';
import { readRequestFacets, requestRef, requestRow } from '../requests';
import type { Inspection, ParsedTopic } from '../../../lib/machines/protocol';
import type { EscalationEvent } from '../../../lib/machines/transport';
import { CONTROLLER, type Action } from './actions';
import type { GatewayState, RequestTrack } from './state';
import { rowOpsOf } from './plan-shared';

const VERB = { CREATED: 'created', UPDATED: 'updated', RESOLVED: 'resolved', CANCELLED: 'cancelled', EXPIRED: 'expired' } as const;
const ENDED: string[] = [VERB.RESOLVED, VERB.CANCELLED, VERB.EXPIRED];

/** The request a message asks the gateway to park; nothing when it asks for no answer. */
export function planRequest(state: GatewayState, parsed: ParsedTopic, seen?: Pick<Inspection, 'answer' | 'receiptId' | 'body'>): Action[] {
  const answer = seen?.answer;
  if (!answer) return [];
  const { siteId, lineId, machineId } = parsed.ident;
  const allowed = rowOpsOf(state);
  if (typeof answer.op !== 'string' || !allowed.includes(answer.op)) {
    return [{ kind: 'refuseRequest', machineId, reason: `${answer.op} is not a command an answer may be sent as; one of ${allowed.join(', ')}` }];
  }
  const ref = requestRef(seen);
  if (!ref) return [{ kind: 'refuseRequest', machineId, reason: 'the message names no id for its answer to name' }];
  const event = seen.body?.body && typeof seen.body.body === 'object' ? seen.body.body as Record<string, unknown> : {};
  return [{ kind: 'parkRequest', machineId, ref, row: requestRow(siteId, lineId, machineId, ref, answer, event) }];
}

/** Track a request row; returns the track when it is new to this gateway. */
export function trackRequest(state: GatewayState, rowId: string, md: Record<string, any> | undefined, createdAt?: string | null): RequestTrack | null {
  if (state.requests.has(rowId)) return null;
  const facets = readRequestFacets(md);
  if (!facets) return null;
  const at = createdAt ? Date.parse(createdAt) : NaN;
  const track: RequestTrack = {
    rowId, machineId: facets.machineId, op: facets.op, ref: facets.ref, createdAt: Number.isFinite(at) ? at : Date.now(),
    ...(facets.withinMs ? { withinMs: facets.withinMs } : {}),
  };
  state.requests.set(rowId, track);
  return track;
}

/** Stop tracking a request; its overdue row, if one is open, is closed. */
export function endRequest(state: GatewayState, rowId: string, note: string): Action[] {
  const track = state.requests.get(rowId);
  state.requests.delete(rowId);
  if (!track?.overdueRowId) return [];
  return [{ kind: 'resolve', as: CONTROLLER, rowId: track.overdueRowId, payload: { decision: DECISION.ANSWERED, note } }];
}

export function planRequestRow(state: GatewayState, event: EscalationEvent): Action[] {
  const id = event.escalationId;
  if (event.verb === VERB.CREATED) {
    const track = trackRequest(state, id, event.data?.metadata, event.data?.created_at);
    return track?.withinMs ? [{ kind: 'watchLate', rowId: id }] : [];
  }
  if (event.verb === VERB.UPDATED) {
    const track = state.requests.get(id) ?? trackRequest(state, id, event.data?.metadata, event.data?.created_at);
    if (!track || track.sending) return [];
    track.sending = true;
    return [{ kind: 'answer', rowId: id }];
  }
  if (ENDED.includes(event.verb)) return endRequest(state, id, `request ${id} ${event.verb}`);
  return [];
}

/** An overdue row the gateway raised: an open one is closed when its request ends. */
export function planOverdueRow(state: GatewayState, event: EscalationEvent): Action[] {
  const track = state.requests.get(event.data?.metadata?.requestId);
  if (!track) return [];
  if (event.verb === VERB.CREATED) {
    track.overdue = true;
    track.overdueRowId ??= event.escalationId;
  } else if (ENDED.includes(event.verb) && track.overdueRowId === event.escalationId) {
    track.overdueRowId = undefined;
  }
  return [];
}
