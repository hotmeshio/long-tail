import type { StreamMessageStatus } from '../../../api/stream-messages';

export const STATUS_DOT: Record<StreamMessageStatus, string> = {
  pending: 'bg-text-tertiary',
  claimed: 'bg-status-warning',
  processed: 'bg-status-success',
  dead_lettered: 'bg-status-error',
};

export const STATUS_LABEL: Record<StreamMessageStatus, string> = {
  pending: 'Pending',
  claimed: 'Claimed',
  processed: 'Processed',
  dead_lettered: 'Dead Lettered',
};

export const SOURCE_BADGE =
  'inline-block px-1.5 py-0.5 text-2xs font-mono rounded bg-surface-sunken text-text-secondary';

export const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'claimed', label: 'Claimed' },
  { value: 'processed', label: 'Processed' },
  { value: 'dead_lettered', label: 'Dead Lettered' },
];

export const SOURCE_OPTIONS = [
  { value: 'engine', label: 'Engine' },
  { value: 'worker', label: 'Worker' },
];
