import { cancelCommandId, type HandoffResolution } from '../contracts';
import { OP } from '../protocol';
import type { Action, Actor } from './actions';
import { DISPATCH_STATE, type HandoffRow } from './state';

/** Withdraw a dispatch that may still sit in the receiver's queue. */
export function cancelDispatch(row: HandoffRow): Action[] {
  if (!row.toMachine || row.dispatch === DISPATCH_STATE.NONE || row.dispatch === DISPATCH_STATE.REFUSED) return [];
  return [{ kind: 'command', machineId: row.toMachine, op: OP.CANCEL, cmdId: cancelCommandId(row.id), args: { jobId: row.jobId } }];
}

/** End a handoff without a receipt: resolve it with the error, then withdraw the dispatch. */
export function failHandoff(row: HandoffRow, as: Actor, resolution: HandoffResolution): Action[] {
  return [{ kind: 'resolve', as, rowId: row.id, payload: { ...resolution } }, ...cancelDispatch(row)];
}
