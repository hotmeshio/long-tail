import { cancelCommandId, type HandoffResolution } from '../contracts';
import { CONTROL_OPS, OP } from '../../../lib/machines/protocol';
import type { Action, Actor } from './actions';
import { dispatchJobs, type DispatchJob } from './jobs';
import { DISPATCH_STATE, type GatewayState, type HandoffRow } from './state';

/** A cancel for each job a handoff's units became at `machineId`, or for those `keep` leaves out. */
export function cancelJobs(
  state: GatewayState, row: HandoffRow, machineId: string, jobId: string, tag = '', keep: (job: DispatchJob) => boolean = () => false,
): Action[] {
  return dispatchJobs(jobId, row.units, state.unitsPerDispatch).filter((job) => !keep(job)).map((job) => ({
    kind: 'command', machineId, op: OP.CANCEL, cmdId: `${cancelCommandId(row.id)}${tag}${job.suffix}`, args: { jobId: job.jobId },
  }));
}

/**
 * Withdraw a dispatch that may still sit in the receiver's queue: one sent or
 * accepted. A job that never went out (the row waiting for room, or for its
 * units to arrive) leaves the receiver nothing to withdraw. A job some of whose
 * units already reached the receiver is under way: it stays, and what happens
 * to it is the workflow's next decision (a machine-command row).
 */
export function cancelDispatch(state: GatewayState, row: HandoffRow): Action[] {
  const to = row.toMachine;
  if (!to || (row.dispatch !== DISPATCH_STATE.PENDING && row.dispatch !== DISPATCH_STATE.ACCEPTED)) return [];
  return cancelJobs(state, row, to, row.jobId, '', (job) => job.units.some((u) => state.heldJob(to, u.unitId) === job.jobId));
}

/**
 * End a handoff without a receipt: resolve it with the error, then withdraw the
 * dispatch. A row the receiver has claimed is resolved by the receiver (only the
 * claimant may resolve a claimed row); `reportedBy` names who saw the failure.
 */
export function failHandoff(state: GatewayState, row: HandoffRow, reporter: Actor, resolution: HandoffResolution): Action[] {
  const claimant = resolverOf(row, reporter);
  const payload = claimant === reporter ? { ...resolution } : { ...resolution, reportedBy: reporter };
  return [{ kind: 'resolve', as: claimant, rowId: row.id, payload }, ...cancelDispatch(state, row)];
}

/** Who resolves a failed handoff: the receiver while it holds the claim, otherwise whoever reports. */
export function resolverOf(row: HandoffRow, reporter: Actor): Actor {
  return row.dispatch === DISPATCH_STATE.ACCEPTED && row.toMachine ? row.toMachine : reporter;
}

/**
 * The row claimed for its resolver before anything else is written to it. A
 * claimed row refuses every other resolver, so what the machine writes next
 * and the resolution that follows land on a row nobody else can end meanwhile.
 */
export function holdForResolver(row: HandoffRow, reporter: Actor): Action {
  return { kind: 'claim', as: resolverOf(row, reporter), rowId: row.id };
}

/** The ops a machine-command row or a request's answer may name: the control ops, a snapshot, and the codec's own. */
export function rowOpsOf(state: GatewayState): string[] {
  return [...CONTROL_OPS, OP.SNAPSHOT, ...state.rowOps];
}
