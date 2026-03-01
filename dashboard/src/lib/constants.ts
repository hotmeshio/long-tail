export const CLAIM_DURATION_OPTIONS = [
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '240', label: '4 hours' },
] as const;

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
] as const;
