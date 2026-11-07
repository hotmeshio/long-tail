/**
 * Where a station returns once a scan act completes its row, read from the
 * station role's `properties.scan_done`. The server validates the shape; the
 * reader here only trusts what checks out.
 */
export interface ScanDonePolicy {
  return: 'home' | string;
  after_seconds?: number;
  /** A button on the done screen that returns at once. */
  button?: string;
}

export const SCAN_DONE_AFTER_SECONDS_DEFAULT = 2;

export function readScanDone(properties: Record<string, unknown> | null | undefined): ScanDonePolicy | null {
  const value = properties?.scan_done;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const policy = value as Record<string, unknown>;
  const ret = policy.return;
  if (typeof ret !== 'string' || !(ret === 'home' || ret.startsWith('/'))) return null;
  const after = policy.after_seconds;
  const button = policy.button;
  return {
    return: ret,
    ...(typeof after === 'number' && after >= 0 ? { after_seconds: after } : {}),
    ...(typeof button === 'string' && button.trim() ? { button } : {}),
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
 * station queue with its own policy wins; otherwise the completed row's role
 * decides. `afterSeconds` is the act's own pause, over the policy's.
 */
export function resolveScanDoneReturn(
  chosen: ScanDoneSource,
  completed: ScanDoneSource | null,
  afterSeconds?: number,
): { path: string; afterMs: number; button?: string } | null {
  const source = chosen.policy ? chosen : completed;
  if (!source?.policy) return null;
  const path = scanDonePath(source.policy, source.homePath);
  if (!path) return null;
  const seconds = afterSeconds ?? source.policy.after_seconds ?? SCAN_DONE_AFTER_SECONDS_DEFAULT;
  return { path, afterMs: seconds * 1000, ...(source.policy.button ? { button: source.policy.button } : {}) };
}
