/**
 * The demo line (demo-line.json): a small three-machine finishing line.
 * MACHINE_LINE_CONFIG points at a JSON file of the same shape for any other line.
 */

import { join } from 'path';

import { loadLine as loadLineFrom, type LineDef } from '../../../lib/machines/line';

export const DEMO_LINE_PATH = join(__dirname, 'demo-line.json');

export const DEFAULT_LINE: LineDef = loadLineFrom(DEMO_LINE_PATH);

/** The line at `path`, or the demo line. */
export function loadLine(path?: string): LineDef {
  return loadLineFrom(path, DEFAULT_LINE);
}
