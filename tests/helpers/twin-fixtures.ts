/**
 * Shared fixtures for the printer-twin reconcile() tests — build poll snapshots,
 * observations, and a registered/bound mirror without repeating boilerplate.
 */

import {
  freshMirror,
  type Mirror,
  type BambuGcodeState,
  type BambuHms,
  type BambuPollResult,
  type TwinObservation,
  type EscalationObservation,
  FILAMENT_HMS,
} from '../../examples/workflows/printer-twin/mirror';
import type { TwinRegistration } from '../../examples/workflows/printer-twin/types';

export const NOW = 1_700_000_000_000;

export const REGISTRATION: TwinRegistration = {
  serialNumber: 'MOCKP1S0000001',
  model: 'C12',
  manufactureDate: '2026-01-15',
  filament: 'pla',
  certifications: 'CE',
  xl: true,
  pdac: false,
  soft: false,
};

export const FILAMENT_RUNOUT_HMS: BambuHms[] = [{ ...FILAMENT_HMS, action: 0, timestamp: 0 }];
export const FAULT_HMS: BambuHms[] = [{ attr: 1, code: 2, action: 0, timestamp: 0 }];

/** A poll snapshot at a given gcode_state; override online/hms/etc as needed. */
export function poll(
  state: BambuGcodeState,
  over: { online?: boolean; bound?: boolean; hms?: BambuHms[]; mcPercent?: number } = {},
): BambuPollResult {
  return {
    ok: true,
    snapshot: {
      sn: 'MOCKP1S0000001',
      model: 'C12',
      name: 'Mock-P1S-01',
      ip: '192.0.2.10',
      online: over.online ?? true,
      bound: over.bound ?? true,
      reportStatus: {
        gcode_state: state,
        mc_percent: over.mcPercent ?? 0,
        mc_remaining_time: 0,
        layer_num: 0,
        total_layer_num: 0,
        gcode_file: '',
        subtask_name: '',
        task_id: '',
        hms: over.hms ?? [],
      },
    },
  };
}

export function obs(over: Partial<TwinObservation> = {}): TwinObservation {
  return { now: NOW, poll: null, escalations: {}, ...over };
}

export function resolved(payload: Record<string, unknown> = {}): EscalationObservation {
  return { status: 'resolved', resolverPayload: payload };
}

/** A mirror that has already onboarded — bound, online, IDLE, ready. */
export function readyMirror(over: Partial<Mirror> = {}): Mirror {
  const m = freshMirror('printer-01', NOW);
  m.registration = REGISTRATION;
  m.sn = REGISTRATION.serialNumber;
  m.model = REGISTRATION.model;
  m.filamentLoaded = 'pla';
  m.bound = true;
  m.online = true;
  m.gcodeState = 'IDLE';
  m.phase = 'ready';
  return { ...m, ...over };
}
