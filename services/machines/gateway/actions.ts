/**
 * The gateway's side effects as data. The planner decides; the executor does.
 * `as` names the identity a verb runs under: a machine id, or the controller.
 */

import type { Disposition } from '../../../lib/machines/transport';
import type { AccumulateConfig } from '../../../types/escalation';

export const CONTROLLER = 'controller';
export type Actor = string;

export interface CreateRowInput {
  type: string;
  subtype?: string;
  role: string;
  description: string;
  priority: number;
  metadata: Record<string, any>;
  /** JSON envelope, e.g. `{ lookups: [...] }` naming the catalog edition a code comes from. */
  envelope?: string;
  /** What the row shows a person, serialized. */
  escalation_payload?: string;
  /** The row is created once per key; a repeat returns the row that holds it. */
  signal_key?: string;
  /** Open the row as an accumulator, so items are added before it resolves. */
  accumulate?: AccumulateConfig;
}

export type Action =
  /**
   * `receivedOnAccept`: the units are already at the machine, so its acceptance completes the handoff.
   * `ended`: the row already resolved; the job is sent again for units the machine still holds, and no verb touches the row.
   */
  | { kind: 'dispatch'; rowId: string; machineId: string; cmdId: string; args: Record<string, any>; issuedAt?: number; receivedOnAccept?: boolean; ended?: boolean }
  | { kind: 'command'; machineId: string; op: string; cmdId: string; args: Record<string, any> }
  /** A host's machine-command row: send the command, resolve the row with the reply. */
  | { kind: 'control'; rowId: string; machineId: string; op: string; args: Record<string, any>; createdAt?: number }
  | { kind: 'claim'; as: Actor; rowId: string }
  /** `metadata` is merged into the row's metadata in the same statement. */
  | { kind: 'accumulate'; as: Actor; rowId: string; itemKey: string; payload: Record<string, any>; metadata?: Record<string, any>; complete?: Completion }
  | { kind: 'resolve'; as: Actor; rowId: string; payload: Record<string, any> }
  | { kind: 'createAlarmRow'; machineId: string; alarmId: string; row: CreateRowInput }
  /** A row for a person, raised by the controller. */
  | { kind: 'createRow'; row: CreateRowInput }
  | { kind: 'watchOffline'; machineId: string }
  | { kind: 'settleReply'; cmdId: string; status: string; reason: string; code?: string; preparing?: boolean }
  /** A machine reported the jobs it holds: answers a status query in flight. */
  | { kind: 'settleSnapshot'; machineId: string; jobIds: string[] }
  /** Bind a station to the address that claims it, and keep the binding in the address book. `by`: who approved it, when someone did. */
  | { kind: 'bindAddress'; machineId: string; address: string; by?: string }
  /** An approved registration the gateway will not bind, and why. */
  | { kind: 'refuseBinding'; machineId: string; address: string; reason: string }
  /** Jobs a restarted machine lost that this gateway cannot send again: nothing of them is remembered. */
  | { kind: 'unrecoverable'; machineId: string; jobs: string[] }
  /** A machine message asks the host for an answer: park its request row, once per message. `row.role` empty: the machine's own role. */
  | { kind: 'parkRequest'; machineId: string; ref: string; row: CreateRowInput }
  /** A message whose answer the gateway cannot ask for, and why. */
  | { kind: 'refuseRequest'; machineId: string; reason: string }
  /** Send the answer a request row holds, then resolve the row. */
  | { kind: 'answer'; rowId: string }
  /** Raise an overdue row once the request's window passes unanswered. */
  | { kind: 'watchLate'; rowId: string };

/** Once the row holds every one of `keys`: resolve it with `payload`, or run `then` instead. */
export interface Completion {
  keys: string[];
  payload?: Record<string, any>;
  then?: Action[];
}

export interface Plan {
  actions: Action[];
  disposition: Disposition;
}
