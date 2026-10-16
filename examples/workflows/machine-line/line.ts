/**
 * The line: site, line and the machines on it, in route order. The default
 * is a small three-machine finishing line; MACHINE_LINE_CONFIG points at a
 * JSON file of the same shape for any other line.
 */

import { readFileSync } from 'fs';

import { assertTopicLevel, clientIdOf, type MachineIdent } from './protocol';

/** Which machine puts a unit on its carrier plate and which takes it off. */
export const CARRIER_ROLE = { BIND: 'bind', RELEASE: 'release', NONE: 'none' } as const;
export type CarrierRole = typeof CARRIER_ROLE[keyof typeof CARRIER_ROLE];

export interface MaterialDef {
  material: string;
  lot: string;
}

export interface MeasurementDef {
  name: string;
  target: number;
  unit?: string;
  min?: number;
  max?: number;
  /** Spread of simulated readings around the target. */
  noise?: number;
}

export interface MachineDef {
  machineId: string;
  process: string;
  description: string;
  carrier: CarrierRole;
  cycleSec: number;
  changeoverSec: number;
  progressEverySec?: number;
  /** The reason a rejected unit reports when none is given. */
  rejectReason: string;
  /** recipe id → versions the machine holds. */
  recipes: Record<string, string[]>;
  materials: MaterialDef[];
  measurements: MeasurementDef[];
  /** fault code → description. */
  faults: Record<string, string>;
}

export interface LineDef {
  siteId: string;
  lineId: string;
  machines: MachineDef[];
}

export const DEFAULT_LINE: LineDef = {
  siteId: 'site-1',
  lineId: 'line-1',
  machines: [
    {
      machineId: 'press-01', process: 'bond', carrier: CARRIER_ROLE.BIND,
      description: 'Bonds a top layer onto the part and seats it on a carrier plate',
      cycleSec: 8, changeoverSec: 3, progressEverySec: 4, rejectReason: 'BOND-WEAK',
      recipes: { 'RCP-BOND-A': ['1', '2'] },
      materials: [{ material: 'BONDING-FILM', lot: 'L-1001' }, { material: 'TOP-LAYER', lot: 'L-1002' }],
      measurements: [
        { name: 'temperature_c', target: 120, unit: 'C', min: 115, max: 125, noise: 1 },
        { name: 'pressure_kpa', target: 300, unit: 'kPa', min: 280, max: 320, noise: 5 },
        { name: 'dwell_s', target: 6, unit: 's', min: 5.5, max: 7, noise: 0.1 },
      ],
      faults: { 'F-101': 'Feeder stalled', 'F-102': 'Heater out of range' },
    },
    {
      machineId: 'cut-01', process: 'trim', carrier: CARRIER_ROLE.RELEASE,
      description: 'Trims the part to its outline and frees the carrier plate',
      cycleSec: 6, changeoverSec: 3, rejectReason: 'EDGE-OUT',
      recipes: { 'RCP-TRIM-A': ['1'] },
      materials: [{ material: 'CUTTER', lot: 'L-2001' }],
      measurements: [
        { name: 'cut_force_n', target: 900, unit: 'N', min: 800, max: 1000, noise: 15 },
        { name: 'feed_mm_s', target: 50, unit: 'mm/s', min: 45, max: 55, noise: 0.8 },
      ],
      faults: { 'F-201': 'Cutter dull', 'F-202': 'Fixture not seated' },
    },
    {
      machineId: 'inspect-01', process: 'inspect', carrier: CARRIER_ROLE.NONE,
      description: 'Measures and images the finished part',
      cycleSec: 4, changeoverSec: 2, rejectReason: 'DIM-FAIL',
      recipes: { 'RCP-INSPECT-A': ['1'] },
      materials: [],
      measurements: [
        { name: 'length_mm', target: 250, unit: 'mm', min: 249, max: 251, noise: 0.3 },
        { name: 'width_mm', target: 90, unit: 'mm', min: 89.5, max: 90.5, noise: 0.15 },
        { name: 'image_score', target: 0.95, min: 0.9, max: 1, noise: 0.005 },
      ],
      faults: { 'F-301': 'Camera not ready' },
    },
  ],
};

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

export function loadLine(path?: string): LineDef {
  if (!path) return validateLine(DEFAULT_LINE);
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

/** The Long Tail role a machine resolves handoffs under. */
export function stationRole(process: string): string {
  return `line-${process.replace(/_/g, '-')}`;
}
