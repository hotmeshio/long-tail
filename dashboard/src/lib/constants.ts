/** Fallback claim durations (minutes) when settings haven't loaded yet. */
export const DEFAULT_CLAIM_DURATIONS = [15, 30, 60, 240];

/** Format a duration in minutes to a human-readable label. */
export function formatClaimDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return hours === 1 ? '1 hour' : `${hours} hours`;
  return `${minutes} min`;
}

export const PRIORITY_OPTIONS = [
  { value: '1', label: 'P1 — Critical' },
  { value: '2', label: 'P2 — High' },
  { value: '3', label: 'P3 — Normal' },
  { value: '4', label: 'P4 — Low' },
] as const;

export const RETENTION_PERIOD_OPTIONS = [
  { value: '1 hour', label: '1 hour' },
  { value: '1 day', label: '1 day' },
  { value: '3 days', label: '3 days' },
  { value: '7 days', label: '7 days' },
  { value: '30 days', label: '30 days' },
  { value: '90 days', label: '90 days' },
  { value: '120 days', label: '4 months' },
  { value: '150 days', label: '5 months' },
  { value: '180 days', label: '6 months' },
  { value: '365 days', label: '1 year' },
] as const;

export const CRON_PRESETS = [
  { value: '0 2 * * *', label: 'Daily at 2 AM' },
  { value: '0 2 * * 0', label: 'Weekly (Sun 2 AM)' },
  { value: '0 2 1 * *', label: 'Monthly (1st at 2 AM)' },
  { value: '0 */6 * * *', label: 'Every 6 hours' },
] as const;
