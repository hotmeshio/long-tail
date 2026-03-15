import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProcessStats } from '../../api/tasks';
import { useProcessListEvents } from '../../hooks/useNatsEvents';
import { PageHeader } from '../../components/common/layout/PageHeader';

// ── Duration filter ──────────────────────────────────────────────────────────

const DURATIONS = [
  { label: '1h', value: '1h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
] as const;

type DurationValue = (typeof DURATIONS)[number]['value'];

// ── Clickable stat cell ──────────────────────────────────────────────────────

function StatCell({
  value,
  colorClass,
  onClick,
}: {
  value: number;
  colorClass: string;
  onClick: () => void;
}) {
  if (value === 0) {
    return <span className="text-text-tertiary">0</span>;
  }
  return (
    <button
      onClick={onClick}
      className={`${colorClass} hover:underline tabular-nums font-medium`}
    >
      {value}
    </button>
  );
}

// ── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  colorClass = 'text-text-primary',
  onClick,
}: {
  label: string;
  value: number | string;
  colorClass?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="bg-surface-raised border border-surface-border rounded-md p-4 text-left hover:border-accent/40 transition-colors"
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">{label}</p>
      <p className={`text-2xl font-light tabular-nums ${colorClass}`}>{value}</p>
    </button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function ProcessesOverview() {
  useProcessListEvents();
  const navigate = useNavigate();
  const [duration, setDuration] = useState<DurationValue>('24h');

  const { data: stats } = useProcessStats(duration);

  const goToList = (params?: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    navigate(`/processes/all${qs ? `?${qs}` : ''}`);
  };

  const thCls = 'pb-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary';

  return (
    <div>
      <PageHeader title="Processes" />

      {/* Duration tabs */}
      <div className="flex items-center gap-1 mb-6">
        {DURATIONS.map((d) => (
          <button
            key={d.value}
            onClick={() => setDuration(d.value)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              duration === d.value
                ? 'bg-accent text-text-inverse'
                : 'text-text-tertiary hover:text-text-primary hover:bg-surface-hover'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <SummaryCard
          label="Total"
          value={stats?.total ?? '—'}
          onClick={() => goToList()}
        />
        <SummaryCard
          label="Active"
          value={stats?.active ?? '—'}
          colorClass="text-status-active"
          onClick={() => goToList({ status: 'active' })}
        />
        <SummaryCard
          label="Completed"
          value={stats?.completed ?? '—'}
          colorClass="text-status-success"
          onClick={() => goToList({ status: 'completed' })}
        />
        <SummaryCard
          label="Escalated"
          value={stats?.escalated ?? '—'}
          colorClass="text-status-error"
          onClick={() => goToList({ status: 'escalated' })}
        />
      </div>

      {/* By workflow type table */}
      {(stats?.by_workflow_type?.length ?? 0) > 0 && (
        <div className="mb-8">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-surface-border">
                <th className={thCls}>Workflow Type</th>
                <th className={`${thCls} text-right w-20`}>Total</th>
                <th className={`${thCls} text-right w-20`}>Active</th>
                <th className={`${thCls} text-right w-24`}>Completed</th>
                <th className={`${thCls} text-right w-24`}>Escalated</th>
              </tr>
            </thead>
            <tbody>
              {stats!.by_workflow_type.map((row) => (
                <tr key={row.workflow_type} className="border-b border-surface-border last:border-b-0">
                  <td className="py-3 text-sm font-mono text-text-primary">
                    <button
                      onClick={() => goToList({ workflow_type: row.workflow_type })}
                      className="hover:text-accent hover:underline"
                    >
                      {row.workflow_type}
                    </button>
                  </td>
                  <td className="py-3 text-sm text-right">
                    <StatCell
                      value={row.total}
                      colorClass="text-text-secondary"
                      onClick={() => goToList({ workflow_type: row.workflow_type })}
                    />
                  </td>
                  <td className="py-3 text-sm text-right">
                    <StatCell
                      value={row.active}
                      colorClass="text-status-active"
                      onClick={() => goToList({ workflow_type: row.workflow_type, status: 'active' })}
                    />
                  </td>
                  <td className="py-3 text-sm text-right">
                    <StatCell
                      value={row.completed}
                      colorClass="text-status-success"
                      onClick={() => goToList({ workflow_type: row.workflow_type, status: 'completed' })}
                    />
                  </td>
                  <td className="py-3 text-sm text-right">
                    <StatCell
                      value={row.escalated}
                      colorClass="text-status-error"
                      onClick={() => goToList({ workflow_type: row.workflow_type, status: 'escalated' })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stats && stats.by_workflow_type.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-sm text-text-tertiary">
            No process activity in the last {duration}
          </p>
        </div>
      )}
    </div>
  );
}
