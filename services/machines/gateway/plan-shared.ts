import { cancelCommandId, type HandoffResolution } from '../contracts';
import { OP } from '../../../lib/machines/protocol';
import type { Action, Actor } from './actions';
import { dispatchJobs } from './jobs';
import { DISPATCH_STATE, type GatewayState, type HandoffRow } from './state';

/** A cancel for each job a handoff's units became at `machineId`. */
export function cancelJobs(state: GatewayState, row: HandoffRow, machineId: string, jobId: string, tag = ''): Action[] {
  return dispatchJobs(jobId, row.units, state.unitsPerDispatch).map((job) => ({
    kind: 'command', machineId, op: OP.CANCEL, cmdId: `${cancelCommandId(row.id)}${tag}${job.suffix}`, args: { jobId: job.jobId },
  }));
}

/** Withdraw a dispatch that may still sit in the receiver's queue. */
export function cancelDispatch(state: GatewayState, row: HandoffRow): Action[] {
  if (!row.toMachine || row.dispatch === DISPATCH_STATE.NONE || row.dispatch === DISPATCH_STATE.REFUSED) return [];
  return cancelJobs(state, row, row.toMachine, row.jobId);
}

/** Stop the sender's job too: a row cancelled while the sender still works its units. */
export function cancelSender(state: GatewayState, row: HandoffRow): Action[] {
  if (!row.fromMachine || !row.senderJobId) return [];
  return cancelJobs(state, row, row.fromMachine, row.senderJobId, ':sender');
}

/**
 * End a handoff without a receipt: resolve it with the error, then withdraw the
 * dispatch. A row the receiver has claimed is resolved by the receiver (only the
 * claimant may resolve a claimed row); `reportedBy` names who saw the failure.
 */
export function failHandoff(state: GatewayState, row: HandoffRow, reporter: Actor, resolution: HandoffResolution): Action[] {
  const claimant = row.dispatch === DISPATCH_STATE.ACCEPTED && row.toMachine ? row.toMachine : reporter;
  const payload = claimant === reporter ? { ...resolution } : { ...resolution, reportedBy: reporter };
  return [{ kind: 'resolve', as: claimant, rowId: row.id, payload }, ...cancelDispatch(state, row)];
}
