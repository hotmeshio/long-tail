import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEscalationStats } from '../../api/escalations';
import { useEscalationStatsEvents } from '../../hooks/useNatsEvents';
import { PageHeader } from '../../components/common/PageHeader';

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

export function EscalationsOverview() {
  useEscalationStatsEvents();
  const navigate = useNavigate();
  const [duration, setDuration] = useState<DurationValue>('24h');

  const { data: stats } = useEscalationStats(duration);

  const goToList = (params?: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    navigate(`/escalations/available${qs ? `?${qs}` : ''}`);
  };

  const thCls = 'pb-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary';

  return (
    <div>
      <PageHeader title="Escalations" />

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
          label="Open"
          value={stats?.pending ?? '—'}
          colorClass="text-status-pending"
          onClick={() => goToList()}
        />
        <SummaryCard
          label="Claimed"
          value={stats?.claimed ?? '—'}
          colorClass="text-status-active"
          onClick={() => goToList()}
        />
        <SummaryCard
          label="Created"
          value={stats?.created ?? '—'}
          onClick={() => goToList()}
        />
        <SummaryCard
          label="Resolved"
          value={stats?.resolved ?? '—'}
          colorClass="text-status-success"
          onClick={() => goToList()}
        />
      </div>

      {/* By-role table */}
      {(stats?.by_role?.length ?? 0) > 0 && (
        <div className="mb-8">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-surface-border">
                <th className={thCls}>Role</th>
                <th className={`${thCls} text-right w-24`}>Pending</th>
                <th className={`${thCls} text-right w-24`}>Claimed</th>
              </tr>
            </thead>
            <tbody>
              {stats!.by_role.map((row) => (
                <tr key={row.role} className="border-b border-surface-border last:border-b-0">
                  <td className="py-3 text-sm font-mono text-text-primary">
                    <button
                      onClick={() => goToList({ role: row.role })}
                      className="hover:text-accent hover:underline"
                    >
                      {row.role}
                    </button>
                  </td>
                  <td className="py-3 text-sm text-right">
                    <StatCell
                      value={row.pending}
                      colorClass="text-status-pending"
                      onClick={() => goToList({ role: row.role })}
                    />
                  </td>
                  <td className="py-3 text-sm text-right">
                    <StatCell
                      value={row.claimed}
                      colorClass="text-status-active"
                      onClick={() => goToList({ role: row.role })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* By-type table */}
      {(stats?.by_type?.length ?? 0) > 0 && (
        <div>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-surface-border">
                <th className={thCls}>Type</th>
                <th className={`${thCls} text-right w-24`}>Pending</th>
                <th className={`${thCls} text-right w-24`}>Claimed</th>
                <th className={`${thCls} text-right w-24`}>Resolved</th>
              </tr>
            </thead>
            <tbody>
              {stats!.by_type.map((row) => (
                <tr key={row.type} className="border-b border-surface-border last:border-b-0">
                  <td className="py-3 text-sm font-mono text-text-primary">
                    <button
                      onClick={() => goToList({ type: row.type })}
                      className="hover:text-accent hover:underline"
                    >
                      {row.type}
                    </button>
                  </td>
                  <td className="py-3 text-sm text-right">
                    <StatCell
                      value={row.pending}
                      colorClass="text-status-pending"
                      onClick={() => goToList({ type: row.type })}
                    />
                  </td>
                  <td className="py-3 text-sm text-right">
                    <StatCell
                      value={row.claimed}
                      colorClass="text-status-active"
                      onClick={() => goToList({ type: row.type })}
                    />
                  </td>
                  <td className="py-3 text-sm text-right">
                    <StatCell
                      value={row.resolved}
                      colorClass="text-status-success"
                      onClick={() => goToList({ type: row.type })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {stats && stats.by_role.length === 0 && stats.by_type.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-sm text-text-tertiary">
            No escalation activity in the last {duration}
          </p>
        </div>
      )}
    </div>
  );
}
