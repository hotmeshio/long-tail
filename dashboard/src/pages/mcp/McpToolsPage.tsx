import { useMemo, useState } from 'react';
import { useMcpServers } from '../../api/mcp';
import { useFilterParams } from '../../hooks/useFilterParams';
import { DataTable, type Column } from '../../components/common/DataTable';
import { StickyPagination } from '../../components/common/StickyPagination';
import { FilterBar, FilterSelect } from '../../components/common/FilterBar';
import { PageHeader } from '../../components/common/PageHeader';
import { TryToolModal } from './TryToolModal';
import type { McpToolManifest } from '../../api/types';

interface ToolRow {
  key: string;
  serverId: string;
  serverName: string;
  tool: McpToolManifest;
  paramCount: number;
}

const columns: Column<ToolRow>[] = [
  {
    key: 'name',
    label: 'Tool',
    render: (row) => (
      <code className="text-xs font-mono text-accent-primary">{row.tool.name}</code>
    ),
  },
  {
    key: 'description',
    label: 'Description',
    render: (row) => (
      <span className="text-xs text-text-secondary line-clamp-2">
        {row.tool.description || '—'}
      </span>
    ),
  },
  {
    key: 'server',
    label: 'Server',
    render: (row) => (
      <span className="text-xs font-mono text-text-secondary">{row.serverName}</span>
    ),
    className: 'w-48',
  },
  {
    key: 'params',
    label: 'Params',
    render: (row) => (
      <span className="text-xs text-text-tertiary">{row.paramCount}</span>
    ),
    className: 'w-20 text-right',
  },
];

export function McpToolsPage() {
  const { data, isLoading } = useMcpServers();
  const servers = data?.servers ?? [];

  const { filters, setFilter, pagination } = useFilterParams({
    filters: { server: '' },
  });

  const [tryTool, setTryTool] = useState<ToolRow | null>(null);

  const allTools = useMemo<ToolRow[]>(() => {
    const rows: ToolRow[] = [];
    for (const srv of servers) {
      if (srv.status !== 'connected' || !Array.isArray(srv.tool_manifest)) continue;
      for (const tool of srv.tool_manifest as McpToolManifest[]) {
        rows.push({
          key: `${srv.id}:${tool.name}`,
          serverId: srv.id,
          serverName: srv.name,
          tool,
          paramCount: Object.keys(tool.inputSchema?.properties ?? {}).length,
        });
      }
    }
    return rows;
  }, [servers]);

  const filtered = useMemo(() => {
    if (!filters.server) return allTools;
    return allTools.filter((r) => r.serverId === filters.server);
  }, [allTools, filters.server]);

  const total = filtered.length;
  const page = filtered.slice(pagination.offset, pagination.offset + pagination.pageSize);

  const serverOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of allTools) {
      if (!seen.has(r.serverId)) seen.set(r.serverId, r.serverName);
    }
    return [...seen.entries()].map(([id, name]) => ({ value: id, label: name }));
  }, [allTools]);

  return (
    <div>
      <PageHeader title="Tools" />

      <p className="text-sm text-text-secondary mb-6 max-w-2xl leading-relaxed">
        Tools from connected MCP servers. Each tool becomes a proxy activity you
        can call from any workflow. Click a row to test it.
      </p>

      <FilterBar>
        <FilterSelect
          label="Server"
          value={filters.server}
          onChange={(v) => setFilter('server', v)}
          options={serverOptions}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={page}
        keyFn={(row) => row.key}
        onRowClick={(row) => setTryTool(row)}
        isLoading={isLoading}
        emptyMessage="No tools available"
      />

      <StickyPagination
        page={pagination.page}
        totalPages={pagination.totalPages(total)}
        onPageChange={pagination.setPage}
        total={total}
        pageSize={pagination.pageSize}
        onPageSizeChange={pagination.setPageSize}
      />

      {tryTool && (
        <TryToolModal
          open={!!tryTool}
          onClose={() => setTryTool(null)}
          serverId={tryTool.serverId}
          serverName={tryTool.serverName}
          tool={tryTool.tool}
        />
      )}
    </div>
  );
}
