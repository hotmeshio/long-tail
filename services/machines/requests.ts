/**
 * Requests as rows: the mirror of commands. A machine asks the host something
 * (a material it was handed, a part it cannot place); its codec marks the
 * message `answer`, and the gateway parks a machine-request row for it, once
 * per message. Whoever decides (a workflow, a scan, a person) adds the answer
 * to the row as its `answer` item, and the gateway sends it to the machine as
 * the op named, naming the message it answers, then resolves the row.
 */

import type { AnswerRequest, Inspection } from '../../lib/machines/protocol';
import { REQUEST_ITEM, ROW_TYPE, requestSignalKey, type RequestAnswer, type RequestFacets } from './contracts';
import type { CreateRowInput } from './gateway/actions';

/** The id an answer names: the codec's, else the message's receipt id, else its envelope id. */
export function requestRef(seen: Pick<Inspection, 'answer' | 'receiptId' | 'body'>): string | null {
  const ref = seen.answer?.ref ?? seen.receiptId ?? seen.body?.id;
  return typeof ref === 'string' && ref ? ref : null;
}

/** What a request row's description says the machine asks. */
function asked(event: Record<string, unknown>, op: string): string {
  const name = event.message_name ?? event.event ?? event.name;
  return typeof name === 'string' && name ? name : `an answer sent as ${op}`;
}

/** The row a machine message's request is parked as; `role` empty means the machine's own role. */
export function requestRow(siteId: string, lineId: string, machineId: string, ref: string, answer: AnswerRequest, event: Record<string, unknown>): CreateRowInput {
  const metadata: RequestFacets = {
    siteId, lineId, machineId, op: answer.op, ref, event,
    ...(typeof answer.withinMs === 'number' && answer.withinMs > 0 ? { withinMs: answer.withinMs } : {}),
  };
  return {
    type: ROW_TYPE.MACHINE_REQUEST,
    subtype: answer.op,
    role: answer.role ?? '',
    description: `${machineId} asks: ${asked(event, answer.op)}`,
    priority: 2,
    metadata: metadata as unknown as Record<string, any>,
    signal_key: requestSignalKey(siteId, lineId, machineId, ref),
    accumulate: {},
  };
}

/** A machine-request row's facets; null when the line, machine, op or ref is missing. */
export function readRequestFacets(md: Record<string, any> = {}): RequestFacets | null {
  if (!md.siteId || !md.lineId || !md.machineId || !md.op || !md.ref) return null;
  const event = md.event && typeof md.event === 'object' && !Array.isArray(md.event) ? md.event : {};
  const withinMs = typeof md.withinMs === 'number' && md.withinMs > 0 ? md.withinMs : undefined;
  return {
    siteId: String(md.siteId), lineId: String(md.lineId), machineId: String(md.machineId), op: String(md.op), ref: String(md.ref), event,
    ...(withinMs ? { withinMs } : {}),
  };
}

/** The item that answers a request: pass it to accumulate on the request's row (API, SDK, MCP or a workflow). */
export function answerItem(args: Record<string, unknown>, op?: string): { itemKey: typeof REQUEST_ITEM.ANSWER; payload: RequestAnswer } {
  return { itemKey: REQUEST_ITEM.ANSWER, payload: { args, ...(op ? { op } : {}) } };
}

/** The answer an item holds; null when it holds none. */
export function readAnswer(items: readonly { itemKey: string; payload: Record<string, any>; actor?: string }[]): (RequestAnswer & { actor?: string }) | null {
  const item = items.find((i) => i.itemKey === REQUEST_ITEM.ANSWER);
  if (!item) return null;
  const p = item.payload ?? {};
  const args = p.args && typeof p.args === 'object' && !Array.isArray(p.args) ? p.args : {};
  return { args, ...(typeof p.op === 'string' && p.op ? { op: p.op } : {}), ...(item.actor ? { actor: item.actor } : {}) };
}
