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

/** A role's return policy beside the home path its `'home'` resolves to. */
export interface ScanDoneSource {
  policy: ScanDonePolicy | null;
  homePath: string | null;
}

/**
 * Where the station goes, and when, once an act completes a row. A chosen
 * station queue with its own policy wins; otherwise the completed row's role decides.
 */
export function resolveScanDoneReturn(
  chosen: ScanDoneSource,
  completed: ScanDoneSource | null,
): { path: string; afterMs: number } | null {
  const source = chosen.policy ? chosen : completed;
  if (!source?.policy) return null;
  const path = scanDonePath(source.policy, source.homePath);
  if (!path) return null;
  return { path, afterMs: (source.policy.after_seconds ?? SCAN_DONE_AFTER_SECONDS_DEFAULT) * 1000 };
}
