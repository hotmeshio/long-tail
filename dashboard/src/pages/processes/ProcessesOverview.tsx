import { useMemo } from 'react';
import { useProcesses } from '../../api/tasks';
import { PageHeaderWithStats } from '../../components/common/PageHeaderWithStats';
import { InsightSearch } from '../../components/insight/InsightSearch';

export function ProcessesOverview() {
  const { data, isLoading } = useProcesses({ limit: 50 });

  const processes = data?.processes ?? [];

  const stats = useMemo(() => {
    let active = 0;
    let completed = 0;
    let escalated = 0;
    for (const j of processes) {
      if (j.escalated > 0) escalated++;
      if (j.completed === j.task_count && j.task_count > 0) completed++;
      else active++;
    }
    return { total: data?.total ?? 0, active, completed, escalated };
  }, [processes, data?.total]);

  const v = (n: number) => (isLoading ? '—' : n);

  return (
    <div>
      <PageHeaderWithStats
        title="Business Processes"
        stats={[
          { label: 'Total', value: v(stats.total) },
          { label: 'Active', value: v(stats.active), dotClass: 'bg-status-active' },
          { label: 'Completed', value: v(stats.completed), dotClass: 'bg-status-success' },
          { label: 'Escalated', value: v(stats.escalated), dotClass: 'bg-status-error' },
        ]}
      />
      <InsightSearch />
    </div>
  );
}
