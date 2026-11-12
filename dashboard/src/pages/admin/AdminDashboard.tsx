import { useTasks } from '../../api/tasks';
import { useEscalations } from '../../api/escalations';
import { useEscalationListEvents } from '../../hooks/useEventHooks';
import { useMcpServers } from '../../api/mcp';
import { PageHeaderWithStats } from '../../components/common/layout/PageHeaderWithStats';
import { useEngine } from '../../hooks/useEngine';

export function AdminDashboard() {
  useEscalationListEvents();
  // Tasks are the HotMesh interceptor's records.
  const { native } = useEngine();
  const { data: taskData } = useTasks({ limit: 1 }, { enabled: native });
  const { data: pendingEsc } = useEscalations({ status: 'pending', limit: 1 });
  const { data: mcpData } = useMcpServers();

  const connectedServers =
    mcpData?.servers?.filter((s) => s.status === 'connected').length ?? 0;
  const mcpLabel = mcpData ? `${connectedServers}/${mcpData.total}` : '—';

  return (
    <div>
      <PageHeaderWithStats
        title="Admin"
        stats={[
          ...(native ? [{ label: 'Tasks', value: taskData?.total ?? '—' }] : []),
          { label: 'Pending Escalations', value: pendingEsc?.total ?? '—', dotClass: 'bg-status-pending' },
          { label: 'MCP Servers', value: mcpLabel },
          { label: 'System', value: 'Healthy', dotClass: 'bg-status-success' },
        ]}
      />
    </div>
  );
}
