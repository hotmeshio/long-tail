import { useMemo } from 'react';
import { useJourneys } from '../../api/tasks';
import { StatCard } from '../../components/common/StatCard';
import { PageHeader } from '../../components/common/PageHeader';

export function JourneysOverview() {
  const { data, isLoading } = useJourneys({ limit: 50 });

  const journeys = data?.journeys ?? [];

  const stats = useMemo(() => {
    let active = 0;
    let completed = 0;
    let escalated = 0;
    for (const j of journeys) {
      if (j.escalated > 0) escalated++;
      if (j.completed === j.task_count && j.task_count > 0) completed++;
      else active++;
    }
    return { total: data?.total ?? 0, active, completed, escalated };
  }, [journeys, data?.total]);

  return (
    <div>
      <PageHeader title="Segments Dashboard" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Segments"
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
