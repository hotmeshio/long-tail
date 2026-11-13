/**
 * Roles and lookups over a line definition. No Node or server imports, so
 * workflow code on any engine can use them.
 */

import type { LineDef, MachineDef } from '../../types/machines';

export function machineById(line: LineDef, machineId: string): MachineDef {
  const def = line.machines.find((m) => m.machineId === machineId);
  if (!def) throw new Error(`machine "${machineId}" is not on ${line.siteId}/${line.lineId}`);
  return def;
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
export const DEFAULT_QUALITY_ROLE = 'line-quality';

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

/** The role of the people who decide units a machine finished on hold: release, rework or scrap. */
export function qualityRole(line: LineDef): string {
  return line.roles?.quality ?? DEFAULT_QUALITY_ROLE;
}
