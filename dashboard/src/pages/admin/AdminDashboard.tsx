import { useTasks } from '../../api/tasks';
import { useEscalations } from '../../api/escalations';
import { useMcpServers } from '../../api/mcp';
import { PageHeader } from '../../components/common/PageHeader';
import { StatCard } from '../../components/common/StatCard';

export function AdminDashboard() {
  const { data: taskData } = useTasks({ limit: 1 });
  const { data: pendingEsc } = useEscalations({ status: 'pending', limit: 1 });
  const { data: mcpData } = useMcpServers();

  const connectedServers =
    mcpData?.servers?.filter((s) => s.status === 'connected').length ?? 0;

  return (
    <div>
      <PageHeader title="Admin Overview" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Tasks"
          value={taskData?.total ?? '—'}
        />
        <StatCard
          label="Pending Escalations"
          value={pendingEsc?.total ?? '—'}
        />
        <StatCard
          label="MCP Servers"
          value={mcpData?.total ?? '—'}
          sub={`${connectedServers} connected`}
        />
        <StatCard
          label="System"
          value="Healthy"
        />
      </div>
    </div>
  );
}
