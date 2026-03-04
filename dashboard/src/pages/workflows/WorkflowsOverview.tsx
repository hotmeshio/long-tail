import { useMemo } from 'react';
import { useJobs, useWorkflowConfigs } from '../../api/workflows';
import { PageHeaderWithStats } from '../../components/common/PageHeaderWithStats';
import { SectionLabel } from '../../components/common/SectionLabel';

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

export function WorkflowsOverview() {
  const { data: allJobs } = useJobs({ limit: 200 });
  const { data: configs } = useWorkflowConfigs();

  const jobs = allJobs?.jobs ?? [];

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

  const running = jobs.filter((j) => j.status === 'running').length;
  const completed = jobs.filter((j) => j.status === 'completed').length;

  return (
    <div>
      <PageHeaderWithStats
        title="Workflows"
        stats={[
          { label: 'Jobs', value: allJobs?.total ?? '—' },
          { label: 'Running', value: running, dotClass: 'bg-status-active' },
          { label: 'Completed', value: completed, dotClass: 'bg-status-success' },
          { label: 'Registered', value: configs?.length ?? '—' },
        ]}
      />

      {byType.length > 0 && (
        <div>
          <SectionLabel className="mb-4">By Workflow Type</SectionLabel>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-surface-border">
                <th className="pb-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Type</th>
                <th className="pb-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary text-right w-20">Total</th>
                <th className="pb-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary text-right w-20">Running</th>
                <th className="pb-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary text-right w-24">Completed</th>
                <th className="pb-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary text-right w-20">Failed</th>
                <th className="pb-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary text-right w-28">Avg Duration</th>
              </tr>
            </thead>
            <tbody>
              {byType.map((row) => (
                <tr key={row.type} className="border-b border-surface-border last:border-b-0">
                  <td className="py-3 text-sm font-mono text-text-primary">{row.type}</td>
                  <td className="py-3 text-sm text-text-secondary text-right">{row.total}</td>
                  <td className="py-3 text-sm text-right">
                    {row.running > 0 ? (
                      <span className="text-status-active">{row.running}</span>
                    ) : (
                      <span className="text-text-tertiary">0</span>
                    )}
                  </td>
                  <td className="py-3 text-sm text-right">
                    {row.completed > 0 ? (
                      <span className="text-status-success">{row.completed}</span>
                    ) : (
                      <span className="text-text-tertiary">0</span>
                    )}
                  </td>
                  <td className="py-3 text-sm text-right">
                    {row.failed > 0 ? (
                      <span className="text-status-error">{row.failed}</span>
                    ) : (
                      <span className="text-text-tertiary">0</span>
                    )}
                  </td>
                  <td className="py-3 text-sm font-mono text-text-secondary text-right">
                    {row.avgDuration !== null ? formatDuration(row.avgDuration) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
