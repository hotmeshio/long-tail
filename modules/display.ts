/**
 * Deployment display settings surfaced to the dashboard via /api/settings.
 * `timeZone` (an IANA name, e.g. "America/Chicago") renders every dashboard
 * date in the deployment's zone; unset, dates render in the browser's zone.
 */
export interface LTDisplayConfig {
  timeZone?: string;
}

let timeZone: string | null = null;

/** True when the runtime knows the IANA zone name. */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Apply the start config's display block; an unknown zone fails the boot. */
export function configureDisplay(patch?: LTDisplayConfig): void {
  const zone = patch?.timeZone;
  if (zone !== undefined && (typeof zone !== 'string' || !isValidTimeZone(zone))) {
    throw new Error(`display.timeZone "${zone}" is not an IANA time zone name`);
  }
  timeZone = zone ?? null;
}

export function getDisplay(): { timeZone: string | null } {
  return { timeZone };
}
