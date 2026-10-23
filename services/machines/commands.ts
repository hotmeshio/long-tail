/**
 * Commands as rows. A host asks a machine to start, stop, pause, resume,
 * change over or cancel a job by parking a machine-command row on the machine's role, from a
 * workflow step or through the API, the same way it asks a person for
 * anything. The gateway sends the command and resolves the row with the
 * machine's reply (CommandResolution), so the step reads the outcome as data.
 */

import type { Op } from '../../lib/machines/protocol';
import { machineById, machineRole, type LineDef } from '../../lib/machines/line';
import { ROW_TYPE, type CommandFacets } from './contracts';

/** Where a command goes: the machine and the role its rows land on. */
export interface CommandTarget {
  siteId: string;
  lineId: string;
  machineId: string;
  role: string;
}

export function commandTarget(line: LineDef, machineId: string): CommandTarget {
  return { siteId: line.siteId, lineId: line.lineId, machineId, role: machineRole(machineById(line, machineId)) };
}

/** The row that asks a machine for `op`: pass it to conditional(), or create it through the API. */
export function commandRow(target: CommandTarget, op: Op, args: Record<string, unknown> = {}) {
  const metadata: CommandFacets = { siteId: target.siteId, lineId: target.lineId, machineId: target.machineId, op, args };
  const recipe = args.recipe as { id?: string; version?: string } | undefined;
  return {
    role: target.role,
    type: ROW_TYPE.MACHINE_COMMAND,
    subtype: op,
    description: recipe?.id ? `${op} ${target.machineId} to ${recipe.id} v${recipe.version}` : `${op} ${target.machineId}`,
    priority: 2,
    metadata: metadata as unknown as Record<string, unknown>,
  };
}

/** A machine-command row's facets; null when the line, machine or op is missing. */
export function readCommandFacets(md: Record<string, any> = {}): CommandFacets | null {
  if (!md.siteId || !md.lineId || !md.machineId || !md.op) return null;
  const args = md.args && typeof md.args === 'object' && !Array.isArray(md.args) ? md.args : {};
  return { siteId: String(md.siteId), lineId: String(md.lineId), machineId: String(md.machineId), op: String(md.op), args };
}
