/**
 * The line: site, line and the machines on it, in route order, read from a
 * JSON file or passed in by the host. MACHINE_LINE_CONFIG names one file, or
 * several separated by commas.
 */

import { readFileSync } from 'fs';

import type { LineDef, MachineDef, MachineIdent, MaterialDef, MeasurementDef } from '../../types/machines';
import { assertTopicLevel, clientIdOf } from './protocol';

export type { LineDef, MachineDef, MaterialDef, MeasurementDef };
export {
  DEFAULT_EXIT_ROLE,
  DEFAULT_OPERATOR_ROLE,
  DEFAULT_QUALITY_ROLE,
  controllerId,
  exitRole,
  machineById,
  machineRole,
  operatorRole,
  qualityRole,
  receiverRoles,
  stationRole,
  stationRoles,
} from './line-roles';

/** How a line knows its machines' addresses (`LineDef.addressing`). */
export const ADDRESSING = { DECLARED: 'declared', LEARNED: 'learned' } as const;

/** Whether the line learns this station's address from the machine that claims it. */
export function learnsAddress(line: LineDef, machineId: string): boolean {
  return line.addressing === ADDRESSING.LEARNED && !line.machines.find((m) => m.machineId === machineId)?.address;
}

/** Which machine puts a unit on its carrier plate and which takes it off. */
export const CARRIER_ROLE = { BIND: 'bind', RELEASE: 'release', NONE: 'none' } as const;
export type CarrierRole = typeof CARRIER_ROLE[keyof typeof CARRIER_ROLE];

/** Reject a line whose identifiers would not survive the topic mapping. */
export function validateLine(line: LineDef): LineDef {
  assertTopicLevel('siteId', line.siteId);
  assertTopicLevel('lineId', line.lineId);
  if (!line.machines?.length) throw new Error('line has no machines');
  if (line.addressing && !Object.values(ADDRESSING).includes(line.addressing)) {
    throw new Error(`addressing must be one of ${Object.values(ADDRESSING).join(', ')}`);
  }
  const seen = new Set<string>();
  const addresses = new Set<string>();
  for (const m of line.machines) {
    assertTopicLevel('machineId', m.machineId);
    if (seen.has(m.machineId)) throw new Error(`duplicate machineId "${m.machineId}"`);
    seen.add(m.machineId);
    if (!learnsAddress(line, m.machineId)) {
      const address = m.address ?? m.machineId;
      assertTopicLevel('address', address);
      if (addresses.has(address)) throw new Error(`duplicate address "${address}"`);
      addresses.add(address);
    }
    if (!(m.cycleSec > 0)) throw new Error(`${m.machineId}: cycleSec must be positive`);
    if (m.queueDepth !== undefined && !(Number.isInteger(m.queueDepth) && m.queueDepth >= 1)) {
      throw new Error(`${m.machineId}: queueDepth must be a whole number of at least 1`);
    }
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

/** Every line in `paths`, a comma-separated list of JSON files (MACHINE_LINE_CONFIG); each site and line once. */
export function loadLines(paths: string | undefined, fallback?: LineDef): LineDef[] {
  const list = (paths ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  if (!list.length) return [loadLine(undefined, fallback)];
  const lines = list.map((p) => loadLine(p));
  const seen = new Set<string>();
  for (const line of lines) {
    const key = `${line.siteId}/${line.lineId}`;
    if (seen.has(key)) throw new Error(`line ${key} is declared twice in MACHINE_LINE_CONFIG`);
    seen.add(key);
  }
  return lines;
}

export function identOf(line: LineDef, machineId: string): MachineIdent {
  const address = line.machines.find((m) => m.machineId === machineId)?.address;
  return { siteId: line.siteId, lineId: line.lineId, machineId, ...(address ? { address } : {}) };
}

/** The broker identity of each machine whose address the line declares, {site}-{line}-{address}. */
export function clientIds(line: LineDef): string[] {
  return line.machines.filter((m) => !learnsAddress(line, m.machineId)).map((m) => clientIdOf(identOf(line, m.machineId)));
}
