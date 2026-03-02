import { useMemo } from 'react';
import { useProcesses } from '../../api/tasks';
import { StatCard } from '../../components/common/StatCard';
import { PageHeader } from '../../components/common/PageHeader';

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

  return (
    <div>
      <PageHeader title="Business Processes" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Processes"
          value={isLoading ? '—' : stats.total}
        />
        <StatCard
          label="Active"
          value={isLoading ? '—' : stats.active}
          dotClass="bg-status-active animate-pulse"
        />
        <StatCard
          label="Completed"
          value={isLoading ? '—' : stats.completed}
          dotClass="bg-status-success"
        />
        <StatCard
          label="Escalated"
          value={isLoading ? '—' : stats.escalated}
          dotClass="bg-status-error"
        />
      </div>
    </div>
  );
}
