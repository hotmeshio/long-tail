/**
 * Parked machine messages (requests.ts): a decoded message the codec marks
 * `answer` parks one request row, and one it marks `notice` parks one notice
 * row. A request's row events tell the gateway when an answer is there to
 * send; either row's end closes its overdue row. Answering is the dispatcher's.
 */

import { DECISION, ROW_TYPE } from '../contracts';
import { noticeRow, readParkedFacets, requestRef, requestRow } from '../requests';
import type { Inspection, ParsedTopic } from '../../../lib/machines/protocol';
import type { EscalationEvent } from '../../../lib/machines/transport';
import { CONTROLLER, type Action } from './actions';
import type { GatewayState, RequestTrack } from './state';
import { rowOpsOf } from './plan-shared';

const VERB = { CREATED: 'created', UPDATED: 'updated', RESOLVED: 'resolved', CANCELLED: 'cancelled', EXPIRED: 'expired' } as const;
const ENDED: string[] = [VERB.RESOLVED, VERB.CANCELLED, VERB.EXPIRED];

export type ParkedSeen = Pick<Inspection, 'answer' | 'notice' | 'receiptId' | 'body'>;

/** The row a message asks the gateway to park: a request, else a notice; nothing when it asks for neither. */
export function planParked(state: GatewayState, parsed: ParsedTopic, seen?: ParkedSeen): Action[] {
  if (!seen?.answer && !seen?.notice) return [];
  const { siteId, lineId, machineId } = parsed.ident;
  const answer = seen.answer;
  if (answer) {
    const allowed = rowOpsOf(state);
    if (typeof answer.op !== 'string' || !allowed.includes(answer.op)) {
      return [{ kind: 'refuseRequest', machineId, reason: `${answer.op} is not a command an answer may be sent as; one of ${allowed.join(', ')}` }];
    }
  }
  const ref = requestRef(seen);
  if (!ref) return [{ kind: 'refuseRequest', machineId, reason: 'the message names no id for its row to be kept under' }];
  const event = seen.body?.body && typeof seen.body.body === 'object' ? seen.body.body as Record<string, unknown> : {};
  const asked = answer ?? seen.notice!;
  const workflow = typeof asked.workflow?.type === 'string' && asked.workflow.type ? { workflow: { type: asked.workflow.type } } : {};
  const row = answer ? requestRow(siteId, lineId, machineId, ref, answer, event) : noticeRow(siteId, lineId, machineId, ref, seen.notice!, event);
  return [{ kind: 'park', machineId, ref, row, ...workflow }];
}

/** Track a parked row; returns the track when it is new to this gateway. */
export function trackRequest(state: GatewayState, rowId: string, type: string | undefined, md: Record<string, any> | undefined, createdAt?: string | null): RequestTrack | null {
  if (state.requests.has(rowId)) return null;
  const facets = readParkedFacets(type, md);
  if (!facets) return null;
  const at = createdAt ? Date.parse(createdAt) : NaN;
  const track: RequestTrack = {
    rowId, type: type!, machineId: facets.machineId, ref: facets.ref, createdAt: Number.isFinite(at) ? at : Date.now(),
    ...(facets.op ? { op: facets.op } : {}),
    ...(facets.withinMs ? { withinMs: facets.withinMs } : {}),
  };
  state.requests.set(rowId, track);
  return track;
}

/** How an overdue row closes once the row it named has ended. */
export const overdueDecision = (type: string | undefined) => (type === ROW_TYPE.MACHINE_NOTICE ? DECISION.RECORDED : DECISION.ANSWERED);

/** Stop tracking a request or notice; its overdue row, if one is open, is closed. */
export function endRequest(state: GatewayState, rowId: string, note: string): Action[] {
  const track = state.requests.get(rowId);
  state.requests.delete(rowId);
  if (!track?.overdueRowId) return [];
  return [{ kind: 'resolve', as: CONTROLLER, rowId: track.overdueRowId, payload: { decision: overdueDecision(track.type), note } }];
}

/** A request or notice row's event: watch a new one, send a request's answer, and close the overdue row of one that ended. */
export function planRequestRow(state: GatewayState, event: EscalationEvent): Action[] {
  const id = event.escalationId;
  const type = event.data?.type;
  if (event.verb === VERB.CREATED) {
    const track = trackRequest(state, id, type, event.data?.metadata, event.data?.created_at);
    return track?.withinMs ? [{ kind: 'watchLate', rowId: id }] : [];
  }
  if (event.verb === VERB.UPDATED) {
    if (type !== ROW_TYPE.MACHINE_REQUEST) return [];
    const track = state.requests.get(id) ?? trackRequest(state, id, type, event.data?.metadata, event.data?.created_at);
    if (!track || track.sending) return [];
    track.sending = true;
    return [{ kind: 'answer', rowId: id }];
  }
  if (ENDED.includes(event.verb)) return endRequest(state, id, `${type ?? 'row'} ${id} ${event.verb}`);
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
