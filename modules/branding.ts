/**
 * Runtime branding config surfaced to the dashboard via /api/settings.
 *
 * The `appName` defaults to 'LongTail' and can be overridden via the
 * `branding` block of the `start()` config — no env-var required, since
 * this is a per-deployment product decision, not an ops toggle.
 */

let _appName = 'LongTail';

export function configureBranding(patch?: { appName?: string }): void {
  if (patch?.appName) _appName = patch.appName;
}

export function getBranding(): { appName: string } {
  return { appName: _appName };
}
