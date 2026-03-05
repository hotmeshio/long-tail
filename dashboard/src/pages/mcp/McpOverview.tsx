import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useMcpServers } from '../../api/mcp';
import { PageHeaderWithStats } from '../../components/common/PageHeaderWithStats';

export function McpOverview() {
  const { data, isLoading } = useMcpServers();
  const servers = data?.servers ?? [];

  const stats = useMemo(() => {
    const connected = servers.filter((s) => s.status === 'connected').length;
    const totalTools = servers.reduce((sum, s) => {
      if (Array.isArray(s.tool_manifest)) return sum + s.tool_manifest.length;
      return sum;
    }, 0);
    return { total: servers.length, connected, totalTools };
  }, [servers]);

  const v = (n: number) => (isLoading ? '—' : n);

  return (
    <div>
      <PageHeaderWithStats
        title="MCP"
        subtitle="Model Context Protocol"
        stats={[
          { label: 'Connected', value: v(stats.connected), dotClass: 'bg-status-success' },
          { label: 'Tools', value: v(stats.totalTools), dotClass: 'bg-status-active' },
          { label: 'Servers', value: v(stats.total) },
        ]}
      />

      <div className="grid grid-cols-2 gap-4">
        <Link
          to="/mcp/tools"
          className="p-6 rounded-lg border border-surface-border/50 hover:border-accent/30 transition-colors group"
        >
          <p className="text-sm font-medium text-text-primary group-hover:text-accent transition-colors">
            Tools
          </p>
          <p className="text-xs text-text-tertiary mt-1">
            Browse and test all {stats.totalTools || ''} tools from connected servers
          </p>
        </Link>

        <Link
          to="/mcp/servers"
          className="p-6 rounded-lg border border-surface-border/50 hover:border-accent/30 transition-colors group"
        >
          <p className="text-sm font-medium text-text-primary group-hover:text-accent transition-colors">
            Servers
          </p>
          <p className="text-xs text-text-tertiary mt-1">
            Manage server connections and configuration
          </p>
        </Link>
      </div>
    </div>
  );
}
