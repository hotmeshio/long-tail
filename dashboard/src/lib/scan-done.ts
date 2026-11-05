/**
 * Where a station returns once a scan act completes its row, read from the
 * station role's `properties.scan_done`. The server validates the shape; the
 * reader here only trusts what checks out.
 */
export interface ScanDonePolicy {
  return: 'home' | string;
  after_seconds?: number;
}

export const SCAN_DONE_AFTER_SECONDS_DEFAULT = 2;

export function readScanDone(properties: Record<string, unknown> | null | undefined): ScanDonePolicy | null {
  const value = properties?.scan_done;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const policy = value as Record<string, unknown>;
  const ret = policy.return;
  if (typeof ret !== 'string' || !(ret === 'home' || ret.startsWith('/'))) return null;
  const after = policy.after_seconds;
  return {
    return: ret,
    ...(typeof after === 'number' && after >= 0 ? { after_seconds: after } : {}),
  };
}

/** The route the station lands on; the kiosk home when the policy says so. */
export function scanDonePath(policy: ScanDonePolicy, homePath: string | null): string | null {
  return policy.return === 'home' ? homePath : policy.return;
}
