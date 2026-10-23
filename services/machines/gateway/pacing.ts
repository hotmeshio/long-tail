/**
 * Pacing: a machine with a queue depth is sent no more jobs than that at once.
 * A handoff beyond it waits in the machine's role queue, unclaimed, the way
 * work waits for a busy person, and the oldest waiting row goes out when the
 * machine has room. A machine's load is every job it has been sent or still
 * holds: rows dispatched into it, rows whose units wait on it to move on, and
 * units that arrived and have not left yet.
 */

import { HANDOFF_ERROR, dispatchCommandId } from '../contracts';
import { isoTs } from '../../../lib/machines/protocol';
import { machineById, type LineDef } from '../../../lib/machines/line';
import { CONTROLLER, type Action } from './actions';
import { dispatchJobs } from './jobs';
import { DISPATCH_STATE, type DispatchState, type GatewayState, type HandoffRow } from './state';
import { reachable } from './registration';

/** Dispatch arguments for a handoff row. */
export function dispatchArgs(row: HandoffRow, expiresAt: number): Record<string, any> {
  return {
    jobId: row.jobId,
    orderRef: row.orderRef,
    recipe: { id: row.recipeId, version: row.recipeVersion },
    units: row.arrivals ? row.units.map((u) => ({ ...u, arrival: row.arrivals?.[u.unitId] ?? null })) : row.units,
    process: row.process,
    from: row.fromMachine,
    expiresAt: isoTs(expiresAt),
    ...(row.artifactUrl ? { artifact: { url: row.artifactUrl, sha256: row.artifactSha256 } } : {}),
    ...(row.parameters ? { parameters: row.parameters } : {}),
  };
}

export function dispatchAction(row: HandoffRow, machineId: string, dispatchTtlMs: number): Action {
  return {
    kind: 'dispatch', rowId: row.id, machineId, cmdId: dispatchCommandId(row.id), args: dispatchArgs(row, Date.now() + dispatchTtlMs),
    ...(row.dispatch === DISPATCH_STATE.ARRIVING ? { receivedOnAccept: true } : {}),
  };
}

/** A machine on a version the line does not allow is refused before any dispatch. */
export function softwareRefusal(state: GatewayState, line: LineDef, machineId: string): string | null {
  const allowed = machineById(line, machineId).allowedSoftware;
  const software = state.links.get(machineId)?.software;
  if (!allowed || !software || allowed.includes(software)) return null;
  return `${machineId} runs ${software}; allowed: ${allowed.join(', ')}`;
}

/** A machine that requires an artifact is never sent a handoff without one: the job's, or one for every unit. */
export function artifactRefusal(line: LineDef, row: HandoffRow): string | null {
  if (!machineById(line, row.toMachine!).requireArtifact || (row.artifactUrl && row.artifactSha256)) return null;
  if (row.units.every((u) => u.artifact)) return null;
  return `${row.toMachine} requires an artifact (url and sha256), for the job or for every unit; the row has none`;
}

const SENT: readonly DispatchState[] = [DISPATCH_STATE.PENDING, DISPATCH_STATE.ACCEPTED];

const jobIdsOf = (state: GatewayState, jobId: string, row: HandoffRow) =>
  dispatchJobs(jobId, row.units, state.unitsPerDispatch).map((j) => j.jobId);

/** The jobs `machineId` has been sent or still holds. */
export function machineLoad(state: GatewayState, machineId: string): Set<string> {
  const jobs = new Set<string>(state.heldAt(machineId));
  for (const r of state.open()) {
    if (r.toMachine === machineId && SENT.includes(r.dispatch)) for (const id of jobIdsOf(state, r.jobId, r)) jobs.add(id);
    if (r.fromMachine === machineId && r.senderJobId) for (const id of jobIdsOf(state, r.senderJobId, r)) jobs.add(id);
  }
  return jobs;
}

/** Whether a row's jobs fit at its receiver; an idle machine always takes the next row, however large. */
function fits(line: LineDef, row: HandoffRow, load: Set<string>, state: GatewayState): boolean {
  const depth = machineById(line, row.toMachine!).queueDepth;
  return !depth || load.size === 0 || load.size + jobIdsOf(state, row.jobId, row).length <= depth;
}

export function hasRoom(state: GatewayState, line: LineDef, row: HandoffRow): boolean {
  return fits(line, row, machineLoad(state, row.toMachine!), state);
}

/** Two open handoffs may not name the same job at one machine: each row, subsets of a route's units included, needs its own. */
export function jobRefusal(state: GatewayState, row: HandoffRow): string | null {
  const other = state.open().find((r) => r.id !== row.id && r.toMachine === row.toMachine && r.jobId === row.jobId && r.dispatch !== DISPATCH_STATE.REFUSED);
  return other ? `job ${row.jobId} at ${row.toMachine} already belongs to handoff ${other.id}` : null;
}

/** The resolution refusing a handoff for the machine's software, a missing artifact or a job id in use; empty when it may go. */
export function refuseUnfit(state: GatewayState, line: LineDef, row: HandoffRow): Action[] {
  const software = softwareRefusal(state, line, row.toMachine!);
  const other = software ?? artifactRefusal(line, row) ?? jobRefusal(state, row);
  if (!other) return [];
  row.dispatch = DISPATCH_STATE.REFUSED;
  const errorCode = software ? HANDOFF_ERROR.SOFTWARE_UNSUPPORTED : HANDOFF_ERROR.DISPATCH_REFUSED;
  return [{ kind: 'resolve', as: CONTROLLER, rowId: row.id, payload: { received: false, errorCode, detail: other } }];
}

/** Send a handoff to its machine now, or refuse it for the machine's software or a missing artifact. */
export function admit(state: GatewayState, line: LineDef, row: HandoffRow, dispatchTtlMs: number): Action[] {
  const refused = refuseUnfit(state, line, row);
  if (refused.length) return refused;
  row.dispatch = DISPATCH_STATE.PENDING;
  return [dispatchAction(row, row.toMachine!, dispatchTtlMs)];
}

/** Dispatch waiting rows, oldest first, while their machines have room; a full machine holds back its later rows too. */
export function planPacing(state: GatewayState, line: LineDef, dispatchTtlMs: number): Action[] {
  const actions: Action[] = [];
  const loads = new Map<string, Set<string>>();
  const full = new Set<string>();
  for (const row of state.open()) {
    const m = row.toMachine;
    // A station that has not registered its address yet keeps its rows waiting.
    if (row.dispatch !== DISPATCH_STATE.WAITING || !m || full.has(m) || !reachable(state, line, m)) continue;
    if (!loads.has(m)) loads.set(m, machineLoad(state, m));
    const load = loads.get(m)!;
    if (!fits(line, row, load, state)) {
      full.add(m);
      continue;
    }
    const admitted = admit(state, line, row, dispatchTtlMs);
    actions.push(...admitted);
    if (admitted.some((a) => a.kind === 'dispatch')) for (const id of jobIdsOf(state, row.jobId, row)) load.add(id);
  }
  return actions;
}
