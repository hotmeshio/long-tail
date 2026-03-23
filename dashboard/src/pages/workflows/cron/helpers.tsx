import type { LTJob } from '../../../api/types';
import type { Column } from '../../../components/common/data/DataTable';
import { TimeAgo } from '../../../components/common/display/TimeAgo';
import { StatusBadge } from '../../../components/common/display/StatusBadge';

// -- Cron descriptions -------------------------------------------------------

const CRON_DESCRIPTIONS: Record<string, string> = {
  '* * * * *': 'Every minute',
  '*/5 * * * *': 'Every 5 minutes',
  '*/15 * * * *': 'Every 15 minutes',
  '*/30 * * * *': 'Every 30 minutes',
  '0 * * * *': 'Every hour',
  '0 */2 * * *': 'Every 2 hours',
  '0 */6 * * *': 'Every 6 hours',
  '0 */12 * * *': 'Every 12 hours',
  '0 0 * * *': 'Daily at midnight',
  '0 9 * * *': 'Daily at 9 AM',
  '0 9 * * 1-5': 'Weekdays at 9 AM',
  '0 0 * * 0': 'Weekly (Sunday midnight)',
  '0 0 1 * *': 'Monthly (1st at midnight)',
  '0 2 * * *': 'Daily at 2 AM',
};

export function describeCron(expr: string): string {
  return CRON_DESCRIPTIONS[expr] ?? '';
}

export const COMMON_PATTERNS: [string, string][] = [
  ['*/15 * * * *', 'Every 15 min'],
  ['0 * * * *', 'Every hour'],
  ['0 */6 * * *', 'Every 6 hours'],
  ['0 9 * * *', 'Daily 9 AM'],
  ['0 9 * * 1-5', 'Weekdays 9 AM'],
  ['0 0 * * 0', 'Weekly (Sun)'],
];

export const DEFAULT_ENVELOPE = '{\n  "data": {},\n  "metadata": {}\n}';

// -- Envelope helpers ---------------------------------------------------------

/** Extract simple string/number/boolean keys from `data` for form view. */
export function extractFormFields(
  envelope: Record<string, unknown>,
): { key: string; value: string; type: string }[] | null {
  const data = envelope?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) return null;
  // Only show form if all values are scalar
  const allScalar = entries.every(
    ([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null,
  );
  if (!allScalar) return null;
  return entries.map(([key, value]) => ({
    key,
    value: value === null ? '' : String(value),
    type: value === null ? 'string' : typeof value,
  }));
}

// -- Recent jobs table columns ------------------------------------------------

export const jobColumns: Column<LTJob>[] = [
  {
    key: 'workflow_id',
    label: 'Workflow ID',
    render: (row) => (
      <span className="font-mono text-[11px] text-text-secondary">
        {row.workflow_id.length > 40
          ? `${row.workflow_id.slice(0, 40)}...`
          : row.workflow_id}
      </span>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    render: (row) => <StatusBadge status={row.status} />,
    className: 'w-28',
  },
  {
    key: 'created_at',
    label: 'Started',
    render: (row) => <TimeAgo date={row.created_at} />,
    className: 'w-32',
  },
];
