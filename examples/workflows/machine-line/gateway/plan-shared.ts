import { cancelCommandId, type HandoffResolution } from '../contracts';
import { OP } from '../protocol';
import type { Action, Actor } from './actions';
import { DISPATCH_STATE, type HandoffRow } from './state';

/** Withdraw a dispatch that may still sit in the receiver's queue. */
export function cancelDispatch(row: HandoffRow): Action[] {
  if (!row.toMachine || row.dispatch === DISPATCH_STATE.NONE || row.dispatch === DISPATCH_STATE.REFUSED) return [];
  return [{ kind: 'command', machineId: row.toMachine, op: OP.CANCEL, cmdId: cancelCommandId(row.id), args: { jobId: row.jobId } }];
}

/** Stop the sender's job too: a row cancelled while the sender still works its units. */
export function cancelSender(row: HandoffRow): Action[] {
  if (!row.fromMachine || !row.senderJobId) return [];
  return [{
    kind: 'command', machineId: row.fromMachine, op: OP.CANCEL,
    cmdId: `${cancelCommandId(row.id)}:sender`, args: { jobId: row.senderJobId },
  }];
}

/** End a handoff without a receipt: resolve it with the error, then withdraw the dispatch. */
export function failHandoff(row: HandoffRow, as: Actor, resolution: HandoffResolution): Action[] {
  return [{ kind: 'resolve', as, rowId: row.id, payload: { ...resolution } }, ...cancelDispatch(row)];
}
