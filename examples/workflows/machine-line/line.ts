/**
 * The demo line (demo-line.json): a small three-machine finishing line.
 * MACHINE_LINE_CONFIG points at a JSON file of the same shape for any other line.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { ADDRESSING, loadLine as loadLineFrom, validateLine, type LineDef } from '../../../lib/machines/line';

export const DEMO_LINE_PATH = join(__dirname, 'demo-line.json');

export const DEFAULT_LINE: LineDef = loadLineFrom(DEMO_LINE_PATH);

/** The line at `path`, or the demo line. */
export function loadLine(path?: string): LineDef {
  return loadLineFrom(path, DEFAULT_LINE);
}

/** Station → the permanent address of the machine at it (MACHINE_LINE_ADDRESSES), for a line that learns them. */
export function readAddresses(path?: string): Record<string, string> | null {
  return path ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, string> : null;
}

/** The line as its machines know it: each machine with its own address. */
export function withAddresses(line: LineDef, addresses: Record<string, string> | null): LineDef {
  if (!addresses) return line;
  return validateLine({ ...line, machines: line.machines.map((m) => (addresses[m.machineId] ? { ...m, address: addresses[m.machineId] } : m)) });
}

/** The line as the gateway knows it: stations only, each learning its machine's address. */
export function learnedLine(line: LineDef): LineDef {
  return validateLine({ ...line, addressing: ADDRESSING.LEARNED, machines: line.machines.map(({ address: _address, ...m }) => m) });
}
