/**
 * The gateway's side effects as data. The planner decides; the executor does.
 * `as` names the identity a verb runs under: a machine id, or the controller.
 */

import type { Disposition } from '../transport';

export const CONTROLLER = 'controller';
export type Actor = string;

export interface CreateRowInput {
  type: string;
  subtype?: string;
  role: string;
  description: string;
  priority: number;
  metadata: Record<string, any>;
}

export type Action =
  | { kind: 'dispatch'; rowId: string; machineId: string; cmdId: string; args: Record<string, any> }
  | { kind: 'command'; machineId: string; op: string; cmdId: string; args: Record<string, any> }
  | { kind: 'claim'; as: Actor; rowId: string }
  | { kind: 'accumulate'; as: Actor; rowId: string; itemKey: string; payload: Record<string, any>; complete?: Completion }
  | { kind: 'resolve'; as: Actor; rowId: string; payload: Record<string, any> }
  | { kind: 'createAlarmRow'; machineId: string; alarmId: string; row: CreateRowInput }
  | { kind: 'watchOffline'; machineId: string }
  | { kind: 'settleReply'; cmdId: string; status: string; reason: string };

/** Resolve the row with `payload` once it holds every one of `keys`. */
export interface Completion {
  keys: string[];
  payload: Record<string, any>;
}

export interface Plan {
  actions: Action[];
  disposition: Disposition;
}
