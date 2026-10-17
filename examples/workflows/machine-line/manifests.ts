/**
 * Route manifests: the same factory run two ways. A manifest names each
 * station in order, a machine by id or a person by role, and the unit
 * workflow walks it without knowing which is which. Minting one manifest or
 * the other per order is how a share of orders runs automated.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { exitRole, type LineDef } from '../../../lib/machines/line';
import type { LTRoleConfig } from '../../../types/startup';
import { HANDOFF_FORM_SCHEMA } from '../../../services/machines/forms';
import { machineStep, type RouteStep } from './workflows/route';

export type ManifestStation = string | { role: string };

export interface Manifest {
  description: string;
  steps: ManifestStation[];
}

export const FACTORY_LINE_PATH = join(__dirname, 'factory-line.json');
export const MANIFESTS_PATH = join(__dirname, 'manifests.json');

export function loadManifests(path = MANIFESTS_PATH): Record<string, Manifest> {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** A manifest's stations as route steps on this line; an unknown machine throws. */
export function manifestSteps(line: LineDef, manifest: Manifest): RouteStep[] {
  return manifest.steps.map((s) => (typeof s === 'string' ? machineStep(line, s) : { role: s.role }));
}

/** Every role a person works in the manifests, except the line's exit role (the line declares it). */
export function personRoleConfigs(line: LineDef, manifests: Record<string, Manifest>): LTRoleConfig[] {
  const roles = new Set<string>();
  for (const m of Object.values(manifests)) for (const s of m.steps) if (typeof s !== 'string') roles.add(s.role);
  roles.delete(exitRole(line));
  return [...roles].map((role) => ({
    role, title: role.replace(/-/g, ' '), description: `Units handed to people at the ${role} station.`,
    form_schema: HANDOFF_FORM_SCHEMA, enforce_schema: false, ops_visible: true,
  }));
}

/**
 * Which manifest the i-th order gets when `percent` of orders run automated:
 * spread evenly, the same answer every time for the same i.
 */
export function automatedAt(i: number, percent: number): boolean {
  const p = Math.max(0, Math.min(100, percent));
  return Math.floor(((i + 1) * p) / 100) > Math.floor((i * p) / 100);
}
