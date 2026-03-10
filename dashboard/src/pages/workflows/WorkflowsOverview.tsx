import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useJobs, useWorkflowConfigs } from '../../api/workflows';
import { useWorkflowListEvents } from '../../hooks/useNatsEvents';
import { PageHeader } from '../../components/common/PageHeader';

// ── Duration filter ──────────────────────────────────────────────────────────

const DURATIONS = [
  { label: '1h', ms: 3_600_000 },
  { label: '24h', ms: 86_400_000 },
  { label: '7d', ms: 604_800_000 },
  { label: '30d', ms: 2_592_000_000 },
] as const;

type DurationLabel = (typeof DURATIONS)[number]['label'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

interface TypeStats {
  type: string;
  total: number;
  running: number;
  completed: number;
  failed: number;
  avgDuration: number | null;
}

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

// ── Page ─────────────────────────────────────────────────────────────────────

export function WorkflowsOverview() {
  useWorkflowListEvents();
  const navigate = useNavigate();
  const [duration, setDuration] = useState<DurationLabel>('24h');

  const { data: allJobs } = useJobs({ limit: 500 });
  const { data: configs } = useWorkflowConfigs();

  const cutoff = useMemo(() => {
    const d = DURATIONS.find((d) => d.label === duration)!;
    return Date.now() - d.ms;
  }, [duration]);

  const jobs = useMemo(
    () => (allJobs?.jobs ?? []).filter((j) => new Date(j.created_at).getTime() >= cutoff),
    [allJobs?.jobs, cutoff],
  );

  const byType = useMemo(() => {
    const map = new Map<string, { total: number; running: number; completed: number; failed: number; durations: number[] }>();
    for (const j of jobs) {
      const entry = map.get(j.entity) ?? { total: 0, running: 0, completed: 0, failed: 0, durations: [] };
      entry.total++;
      if (j.status === 'running') entry.running++;
      if (j.status === 'completed') {
        entry.completed++;
        const dur = new Date(j.updated_at).getTime() - new Date(j.created_at).getTime();
        if (dur > 0) entry.durations.push(dur);
      }
      if (j.status === 'failed') entry.failed++;
      map.set(j.entity, entry);
    }

    const result: TypeStats[] = [];
    for (const [type, stats] of map) {
      result.push({
        type,
        ...stats,
        avgDuration: stats.durations.length > 0
          ? stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length
          : null,
      });
    }
    return result.sort((a, b) => b.total - a.total);
  }, [jobs]);

  // Totals
  const totals = useMemo(() => ({
    total: jobs.length,
    running: jobs.filter((j) => j.status === 'running').length,
    completed: jobs.filter((j) => j.status === 'completed').length,
    failed: jobs.filter((j) => j.status === 'failed').length,
  }), [jobs]);

  const registered = configs?.length ?? 0;

  const goToList = (entity?: string, status?: string) => {
    const params = new URLSearchParams();
    if (entity) params.set('entity', entity);
    if (status) params.set('status', status);
    const qs = params.toString();
    navigate(`/workflows/runs${qs ? `?${qs}` : ''}`);
  };

  const thCls = 'pb-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary';

  return (
    <div>
      <PageHeader
        title="Workflows"
        actions={
          <span className="text-xs text-text-tertiary">
            {registered} registered type{registered !== 1 ? 's' : ''}
          </span>
        }
      />

      {/* Duration tabs */}
      <div className="flex items-center gap-1 mb-6">
        {DURATIONS.map((d) => (
          <button
            key={d.label}
            onClick={() => setDuration(d.label)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              duration === d.label
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
        <SummaryCard label="Total" value={totals.total} onClick={() => goToList()} />
        <SummaryCard label="Running" value={totals.running} colorClass="text-status-active" onClick={() => goToList(undefined, 'running')} />
        <SummaryCard label="Completed" value={totals.completed} colorClass="text-status-success" onClick={() => goToList(undefined, 'completed')} />
        <SummaryCard label="Failed" value={totals.failed} colorClass="text-status-error" onClick={() => goToList(undefined, 'failed')} />
      </div>

      {/* By-type table */}
      {byType.length > 0 && (
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-surface-border">
              <th className={thCls}>Type</th>
              <th className={`${thCls} text-right w-20`}>Total</th>
              <th className={`${thCls} text-right w-20`}>Running</th>
              <th className={`${thCls} text-right w-24`}>Completed</th>
              <th className={`${thCls} text-right w-20`}>Failed</th>
              <th className={`${thCls} text-right w-28`}>Avg Duration</th>
            </tr>
          </thead>
          <tbody>
            {byType.map((row) => (
              <tr key={row.type} className="border-b border-surface-border last:border-b-0">
                <td className="py-3 text-sm font-mono text-text-primary">
                  <button
                    onClick={() => goToList(row.type)}
                    className="hover:text-accent hover:underline"
                  >
                    {row.type}
                  </button>
                </td>
                <td className="py-3 text-sm text-right">
                  <StatCell value={row.total} colorClass="text-text-secondary" onClick={() => goToList(row.type)} />
                </td>
                <td className="py-3 text-sm text-right">
                  <StatCell value={row.running} colorClass="text-status-active" onClick={() => goToList(row.type, 'running')} />
                </td>
                <td className="py-3 text-sm text-right">
                  <StatCell value={row.completed} colorClass="text-status-success" onClick={() => goToList(row.type, 'completed')} />
                </td>
                <td className="py-3 text-sm text-right">
                  <StatCell value={row.failed} colorClass="text-status-error" onClick={() => goToList(row.type, 'failed')} />
                </td>
                <td className="py-3 text-sm font-mono text-text-secondary text-right">
                  {row.avgDuration !== null ? formatDuration(row.avgDuration) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {byType.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-sm text-text-tertiary">
            No workflow activity in the last {duration}
          </p>
        </div>
      )}
    </div>
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
  value: number;
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
