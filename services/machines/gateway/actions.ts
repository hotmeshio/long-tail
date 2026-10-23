/**
 * The gateway's side effects as data. The planner decides; the executor does.
 * `as` names the identity a verb runs under: a machine id, or the controller.
 */

import type { Disposition } from '../../../lib/machines/transport';

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
}

export type Action =
  /** `receivedOnAccept`: the units are already at the machine, so its acceptance completes the handoff. */
  | { kind: 'dispatch'; rowId: string; machineId: string; cmdId: string; args: Record<string, any>; receivedOnAccept?: boolean }
  | { kind: 'command'; machineId: string; op: string; cmdId: string; args: Record<string, any> }
  /** A host's machine-command row: send the command, resolve the row with the reply. */
  | { kind: 'control'; rowId: string; machineId: string; op: string; cmdId: string; args: Record<string, any> }
  | { kind: 'claim'; as: Actor; rowId: string }
  /** `metadata` is merged into the row's metadata in the same statement. */
  | { kind: 'accumulate'; as: Actor; rowId: string; itemKey: string; payload: Record<string, any>; metadata?: Record<string, any>; complete?: Completion }
  | { kind: 'resolve'; as: Actor; rowId: string; payload: Record<string, any> }
  | { kind: 'createAlarmRow'; machineId: string; alarmId: string; row: CreateRowInput }
  /** A row for a person, raised by the controller. */
  | { kind: 'createRow'; row: CreateRowInput }
  | { kind: 'watchOffline'; machineId: string }
  | { kind: 'settleReply'; cmdId: string; status: string; reason: string }
  /** A machine reported the jobs it holds: answers a status query in flight. */
  | { kind: 'settleSnapshot'; machineId: string; jobIds: string[] }
  /** Bind a station to the address that claims it, and keep the binding in the address book. `by`: who approved it, when someone did. */
  | { kind: 'bindAddress'; machineId: string; address: string; by?: string }
  /** An approved registration the gateway will not bind, and why. */
  | { kind: 'refuseBinding'; machineId: string; address: string; reason: string };

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
