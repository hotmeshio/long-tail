/**
 * Ready pacing (`MachineDef.paceBy: 'ready'`). A machine's ready is an open
 * machine-ready row, so the leader after a takeover reads it back. A dispatch
 * spends one; the machine's acceptance resolves that row, naming the handoff,
 * and a dispatch that ends unaccepted gives it back. A new leader also gives
 * back the last ready spent on a handoff still unclaimed, and sends that
 * handoff again.
 */

import { DECISION, ROW_TYPE, readySignalKey } from '../contracts';
import { readyRow } from '../commands';
import type { LineDef } from '../../../lib/machines/line';
import type { Envelope, ParsedTopic } from '../../../lib/machines/protocol';
import type { EscalationEvent } from '../../../lib/machines/transport';
import { CONTROLLER, type Action } from './actions';
import { resolverPayloadOf, type LineEscalations } from './escalations';
import { DISPATCH_STATE, type GatewayState } from './state';

const VERB = { CREATED: 'created', CLAIMED: 'claimed', UPDATED: 'updated' } as const;
const OPEN_STATUS = 'pending';

/** Whether `machineId` holds a ready no dispatch has spent. */
export function isReady(state: GatewayState, machineId: string): boolean {
  return [...state.readyRows.values()].includes(machineId);
}

function dispatchInFlight(state: GatewayState, machineId: string): boolean {
  return [...state.readySpent.values()].some((s) => s.machineId === machineId);
}

/**
 * A ready the machine said (a `ready` message, or a snapshot's `ready`). One row is raised, keyed by the
 * message, unless the machine already holds a ready, one is being raised, or its last one awaits acceptance.
 * `ready: false` withdraws every ready it holds.
 */
export function planReady(state: GatewayState, parsed: ParsedTopic, env: Envelope | null, ready: unknown): Action[] {
  const { siteId, lineId, machineId: m } = parsed.ident;
  const role = state.readyPaced.get(m);
  if (!role) return [];
  if (ready === false) return withdrawReady(state, m);
  if (isReady(state, m) || state.readyCreating.has(m) || dispatchInFlight(state, m)) return [];
  state.readyCreating.add(m);
  const base = readyRow({ siteId, lineId, machineId: m, role }, 'the machine said it is ready');
  const ref = env?.id ?? env?.at ?? String(Date.now());
  return [{
    kind: 'createReadyRow', machineId: m,
    row: { ...base, metadata: { ...base.metadata, ref }, signal_key: readySignalKey(siteId, lineId, m, ref) },
  }];
}

function withdrawReady(state: GatewayState, m: string): Action[] {
  const actions: Action[] = [];
  for (const [id, machineId] of [...state.readyRows]) {
    if (machineId !== m) continue;
    state.readyRows.delete(id);
    actions.push({ kind: 'resolve', as: CONTROLLER, rowId: id, payload: { decision: DECISION.WITHDRAWN } });
  }
  return actions;
}

/** A ready row the gateway raised, now created; one already ended or already spent is not a ready. */
export function readyCreated(state: GatewayState, machineId: string, rowId: string, status?: string): void {
  if (status && status !== OPEN_STATUS) return;
  if ([...state.readySpent.values()].some((s) => s.readyRowId === rowId)) return;
  state.readyRows.set(rowId, machineId);
}

/** A machine-ready row's event: open rows on this line's paced machines are readies, ended ones are not. */
export function planReadyRow(state: GatewayState, line: LineDef, event: EscalationEvent): Action[] {
  const md = event.data?.metadata ?? {};
  const id = event.escalationId;
  if (event.verb === VERB.CREATED || event.verb === VERB.CLAIMED) {
    const mine = md.siteId === line.siteId && md.lineId === line.lineId && state.readyPaced.has(md.machineId);
    if (mine && ![...state.readySpent.values()].some((s) => s.readyRowId === id)) state.readyRows.set(id, md.machineId);
  } else if (event.verb !== VERB.UPDATED) {
    state.readyRows.delete(id);
  }
  return [];
}

/** A dispatch of `handoffRowId` to a paced machine spends one of its readies. */
export function spendReady(state: GatewayState, machineId: string, handoffRowId: string): void {
  if (!state.readyPaced.has(machineId)) return;
  const [readyRowId] = [...state.readyRows].find(([, m]) => m === machineId) ?? [];
  if (!readyRowId) return;
  state.readyRows.delete(readyRowId);
  state.readySpent.set(handoffRowId, { readyRowId, machineId });
}

/** The machine accepted the dispatch: the ready row it spent, and the resolution naming the handoff. */
export function readyAccepted(state: GatewayState, handoffRowId: string): { rowId: string; payload: Record<string, unknown> } | null {
  const spent = state.readySpent.get(handoffRowId);
  if (!spent) return null;
  state.readySpent.delete(handoffRowId);
  return { rowId: spent.readyRowId, payload: { decision: DECISION.DISPATCHED, rowId: handoffRowId } };
}

/** The dispatch ended unaccepted: the machine is ready still, so its ready goes back. */
export function readyUnspent(state: GatewayState, handoffRowId: string): void {
  const spent = state.readySpent.get(handoffRowId);
  if (!spent) return;
  state.readySpent.delete(handoffRowId);
  state.readyRows.set(spent.readyRowId, spent.machineId);
}

/**
 * The readies a new leader reads back, after the open handoffs: every open ready row, and for a paced
 * machine with none, the last ready it spent when that handoff is still open and unclaimed.
 */
export async function restoreReady(state: GatewayState, lt: LineEscalations, line: LineDef): Promise<number> {
  if (!state.readyPaced.size) return 0;
  const facets = { siteId: line.siteId, lineId: line.lineId };
  const open = (await lt.listOpen({ type: ROW_TYPE.MACHINE_READY }))
    .filter((row) => row.metadata?.siteId === line.siteId && row.metadata?.lineId === line.lineId && state.readyPaced.has(row.metadata?.machineId));
  for (const row of open) state.readyRows.set(row.id, row.metadata.machineId);
  let restored = open.length;
  for (const machineId of state.readyPaced.keys()) {
    if (isReady(state, machineId)) continue;
    const [last] = await lt.listEnded({ type: ROW_TYPE.MACHINE_READY, facets: { ...facets, machineId }, limit: 1 });
    const spentOn = last ? resolverPayloadOf(last).rowId : undefined;
    const handoff = typeof spentOn === 'string' ? state.get(spentOn) : undefined;
    if (!handoff || (handoff.dispatch !== DISPATCH_STATE.WAITING && handoff.dispatch !== DISPATCH_STATE.NONE)) continue;
    state.readyRows.set(last.id, machineId);
    restored++;
  }
  return restored;
}
