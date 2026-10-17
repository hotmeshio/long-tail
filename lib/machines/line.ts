/**
 * The line: site, line and the machines on it, in route order, read from a
 * JSON file (MACHINE_LINE_CONFIG) or passed in by the host.
 */

import { readFileSync } from 'fs';

import type { LineDef, MachineDef, MachineIdent, MaterialDef, MeasurementDef } from '../../types/machines';
import { assertTopicLevel, clientIdOf } from './protocol';

export type { LineDef, MachineDef, MaterialDef, MeasurementDef };

/** Which machine puts a unit on its carrier plate and which takes it off. */
export const CARRIER_ROLE = { BIND: 'bind', RELEASE: 'release', NONE: 'none' } as const;
export type CarrierRole = typeof CARRIER_ROLE[keyof typeof CARRIER_ROLE];

/** Reject a line whose identifiers would not survive the topic mapping. */
export function validateLine(line: LineDef): LineDef {
  assertTopicLevel('siteId', line.siteId);
  assertTopicLevel('lineId', line.lineId);
  if (!line.machines?.length) throw new Error('line has no machines');
  const seen = new Set<string>();
  for (const m of line.machines) {
    assertTopicLevel('machineId', m.machineId);
    if (seen.has(m.machineId)) throw new Error(`duplicate machineId "${m.machineId}"`);
    seen.add(m.machineId);
    if (!(m.cycleSec > 0)) throw new Error(`${m.machineId}: cycleSec must be positive`);
  }
  return line;
}

/** The line at `path` (JSON), or `fallback` when no path is given. */
export function loadLine(path: string | undefined, fallback?: LineDef): LineDef {
  if (!path) {
    if (!fallback) throw new Error('no line definition: set MACHINE_LINE_CONFIG or pass one');
    return validateLine(fallback);
  }
  return validateLine(JSON.parse(readFileSync(path, 'utf8')) as LineDef);
}

export function identOf(line: LineDef, machineId: string): MachineIdent {
  return { siteId: line.siteId, lineId: line.lineId, machineId };
}

export function machineById(line: LineDef, machineId: string): MachineDef {
  const def = line.machines.find((m) => m.machineId === machineId);
  if (!def) throw new Error(`machine "${machineId}" is not on ${line.siteId}/${line.lineId}`);
  return def;
}

/** The broker identity of each machine, {site}-{line}-{machine}. */
export function clientIds(line: LineDef): string[] {
  return line.machines.map((m) => clientIdOf(identOf(line, m.machineId)));
}

/** The broker and Long Tail identity of the line's gateway. */
export function controllerId(line: LineDef): string {
  return `line-controller-${line.siteId}-${line.lineId}`;
}

/** The default role name for a process. */
export function stationRole(process: string): string {
  return `line-${process.replace(/_/g, '-')}`;
}

export const DEFAULT_EXIT_ROLE = 'line-exit';
export const DEFAULT_OPERATOR_ROLE = 'line-operator';

/** The Long Tail role a machine resolves handoffs under. */
export function machineRole(def: Pick<MachineDef, 'role' | 'process'>): string {
  return def.role ?? stationRole(def.process);
}

/** Every station role on the line, once each, in route order. */
export function stationRoles(line: LineDef): string[] {
  return [...new Set(line.machines.map(machineRole))];
}

/** The role of the person who receives units at line exit. */
export function exitRole(line: LineDef): string {
  return line.roles?.exit ?? DEFAULT_EXIT_ROLE;
}

/** Roles of people who take units straight from a machine: the exit role and any receivers. */
export function receiverRoles(line: LineDef): string[] {
  return [...new Set([exitRole(line), ...(line.roles?.receivers ?? [])])];
}

/** The role of the person who decides failed handoffs and closes alarm and machine rows. */
export function operatorRole(line: LineDef): string {
  return line.roles?.operator ?? DEFAULT_OPERATOR_ROLE;
}
