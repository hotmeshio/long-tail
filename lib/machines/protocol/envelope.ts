import type { Envelope, MachineIdent } from '../../../types/machines';

export type { Envelope, MachineIdent };
import { randomUUID } from 'crypto';

import { PROTOCOL_VERSION } from './constants';

/** The machine's wire address: its topic level and client id. */
export function addressOf(ident: MachineIdent): string {
  return ident.address ?? ident.machineId;
}

/** {site}-{line}-{address}, stable across reconnects. */
export function clientIdOf(ident: MachineIdent): string {
  return `${ident.siteId}-${ident.lineId}-${addressOf(ident)}`;
}

/** ISO 8601 UTC with milliseconds. */
export function isoTs(at: Date | number = Date.now()): string {
  return new Date(at).toISOString();
}

export function buildEnvelope<T>(ident: MachineIdent, body: T, opts: { at?: string; id?: string } = {}): Envelope<T> {
  return {
    v: PROTOCOL_VERSION,
    id: opts.id ?? randomUUID(),
    at: opts.at ?? isoTs(),
    source: { site: ident.siteId, line: ident.lineId, machine: addressOf(ident), ...(ident.address && ident.address !== ident.machineId ? { station: ident.machineId } : {}) },
    body,
  };
}

/** Parse a JSON payload; null when it is empty or not an object. */
export function parsePayload(raw: string | Buffer): Envelope | null {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
