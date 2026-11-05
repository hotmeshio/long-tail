import { ROLE_PROPERTY_KEYS, type RoleScanDone } from './types';

export const SCAN_DONE_RETURN_HOME = 'home';
export const SCAN_DONE_AFTER_SECONDS_DEFAULT = 2;
const AFTER_SECONDS_MAX = 60;

/** The problem with a `properties.scan_done` value, or null when it is usable (or absent). */
export function scanDoneError(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return 'properties.scan_done must be an object';
  const done = value as Record<string, unknown>;
  const known = new Set(['return', 'after_seconds']);
  const extra = Object.keys(done).filter((k) => !known.has(k));
  if (extra.length) return `properties.scan_done has unknown key(s): ${extra.join(', ')}`;
  if (typeof done.return !== 'string' || !(done.return === SCAN_DONE_RETURN_HOME || done.return.startsWith('/'))) {
    return `properties.scan_done.return must be '${SCAN_DONE_RETURN_HOME}' or a dashboard-relative route`;
  }
  if (done.after_seconds !== undefined
    && (!Number.isInteger(done.after_seconds) || (done.after_seconds as number) < 0 || (done.after_seconds as number) > AFTER_SECONDS_MAX)) {
    return `properties.scan_done.after_seconds must be an integer from 0 to ${AFTER_SECONDS_MAX}`;
  }
  return null;
}

/** The role's return policy from its properties bag, or null when it declares none (or an unusable one). */
export function readScanDone(properties: Record<string, unknown> | null | undefined): RoleScanDone | null {
  const value = properties?.[ROLE_PROPERTY_KEYS.SCAN_DONE];
  if (value === undefined || value === null || scanDoneError(value)) return null;
  return value as RoleScanDone;
}
