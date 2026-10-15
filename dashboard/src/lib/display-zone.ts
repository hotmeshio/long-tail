import { format as fnsFormat } from 'date-fns';

/**
 * The deployment's display time zone (an IANA name from settings). Unset,
 * dates render in the browser's zone, as they always have.
 */
let displayTimeZone: string | null = null;

export function setDisplayTimeZone(zone: string | null | undefined): void {
  displayTimeZone = zone || null;
}

export function getDisplayTimeZone(): string | null {
  return displayTimeZone;
}

type Parts = Record<string, string>;

function zonedParts(date: Date, zone: string, withSeconds: boolean): Parts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: true,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** "Oct 13, 2026 1:02 AM" in the display zone. */
export function formatDisplayDateTime(iso: string | Date, withSeconds = false): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return String(iso);
  if (!displayTimeZone) return fnsFormat(date, withSeconds ? 'MMM d, yyyy h:mm:ss a' : 'MMM d, yyyy h:mm a');
  const p = zonedParts(date, displayTimeZone, withSeconds);
  const time = `${p.hour}:${p.minute}${withSeconds ? `:${p.second}` : ''}`;
  return `${p.month} ${p.day}, ${p.year} ${time} ${p.dayPeriod}`;
}
