/**
 * The running machine surface, for settings and the machines API. Set by
 * start() when the config declares lines; absent otherwise, so a deployment
 * without machines serves no lines and no Lines view.
 */

import type { LineSurface } from '../services/machines/surface';

let surface: LineSurface | null = null;

export function registerMachineSurface(next: LineSurface | null): void {
  surface = next;
}

export function getMachineSurface(): LineSurface | null {
  return surface;
}
