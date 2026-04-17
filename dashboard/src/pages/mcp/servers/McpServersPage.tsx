import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useMcpServers,
  useConnectMcpServer,
  useDisconnectMcpServer,
  useDeleteMcpServer,
} from '../../../api/mcp';
import { EmptyState } from '../../../components/common/display/EmptyState';
import { ConfirmDeleteModal } from '../../../components/common/modal/ConfirmDeleteModal';
import type { McpServerRecord, McpToolManifest } from '../../../api/types';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { FilterBar, FilterSelect, FilterInput } from '../../../components/common/data/FilterBar';
import { StickyPagination } from '../../../components/common/data/StickyPagination';
import { useFilterParams } from '../../../hooks/useFilterParams';
import { useExpandedRows } from '../../../hooks/useExpandedRows';
import { ToolTestPanel } from '../../../components/common/test/ToolTestPanel';
import { matchesSearch, filterTools } from './helpers';
import { ServerRow } from './ServerRow';

export function McpServersPage() {
  const navigate = useNavigate();
  const { filters, setFilter, pagination } = useFilterParams({
    filters: { status: '', search: '', tag: '' },
  });

  const { data, isLoading } = useMcpServers({
    status: filters.status || undefined,
    search: filters.search || undefined,
    tags: filters.tag || undefined,
  });
  const connect = useConnectMcpServer();
  const disconnect = useDisconnectMcpServer();
  const deleteServer = useDeleteMcpServer();

  const [confirmDelete, setConfirmDelete] = useState<McpServerRecord | null>(null);
  const { expandedIds, toggle: toggleExpand } = useExpandedRows('lt:expanded:mcp-servers');
  const [tryTool, setTryTool] = useState<{
    serverId: string;
    serverName: string;
    tool: McpToolManifest;
  } | null>(null);

  const servers = data?.servers ?? [];
  const total = data?.total ?? 0;

  // Derive unique tags from current result set for the filter dropdown
  const tagOptions = useMemo(() => {
    const allTags = new Set<string>();
    for (const s of servers) {
      for (const t of s.tags ?? []) allTags.add(t);
    }
    return [...allTags].sort().map((t) => ({ value: t, label: t }));
  }, [servers]);

  // Client-side search filtering for tool-level matches within expanded rows
  const filteredServers = useMemo(() => {
    if (!filters.search) return servers;
    return servers.filter((s) => matchesSearch(s, filters.search));
  }, [servers, filters.search]);

  // Auto-expand servers whose tools match the search (so results are visible)
  useEffect(() => {
    if (!filters.search) return;
    const q = filters.search.toLowerCase();
    for (const s of filteredServers) {
      const tools = (s.tool_manifest ?? []) as McpToolManifest[];
      const hasToolMatch = tools.some(
        (t) => t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q),
      );
      if (hasToolMatch && !expandedIds.has(s.id)) {
        toggleExpand(s.id);
      }
    }
  }, [filters.search, filteredServers]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = () => {
    if (!confirmDelete) return;
    deleteServer.mutate(confirmDelete.id, {
      onSuccess: () => setConfirmDelete(null),
    });
  };

  if (isLoading) {
    return (
      <div>
        <PageHeader title="MCP Server Tools" />
        <div className="animate-pulse space-y-0">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 border-b last:border-b-0 px-6 flex items-center">
              <div className="h-3 bg-surface-sunken rounded w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="MCP Server Tools"
        actions={
          <button
            onClick={() => navigate('/mcp/servers/new')}
            className="btn-primary text-xs"
          >
            Register Server
          </button>
        }
      />

      <p className="text-sm text-text-secondary mb-6 max-w-2xl leading-relaxed">
        Registered MCP servers and their available tools. Each server exposes tools that can be used by the Pipeline Designer.
      </p>

      <FilterBar>
        <FilterInput
          label="Search"
          value={filters.search}
          onChange={(v) => setFilter('search', v)}
          placeholder="Server or tool name..."
        />
        <FilterSelect
          label="Tag"
          value={filters.tag}
          onChange={(v) => setFilter('tag', v)}
          options={tagOptions}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          options={[
            { value: 'registered', label: 'Registered' },
            { value: 'connected', label: 'Connected' },
            { value: 'error', label: 'Error' },
            { value: 'disconnected', label: 'Disconnected' },
          ]}
        />
      </FilterBar>

      <div className={`flex gap-0 ${tryTool ? '' : ''}`}>
        {/* Server list */}
        <div className={`${tryTool ? 'flex-1 min-w-0' : 'w-full'} transition-all`}>
          {filteredServers.length === 0 ? (
            <EmptyState title="No servers found" />
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="sticky top-[2.75rem] z-10 bg-surface px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                    Server / Tool
                  </th>
                  <th className="sticky top-[2.75rem] z-10 bg-surface px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-28">
                    Status
                  </th>
                  <th className="sticky top-[2.75rem] z-10 bg-surface px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-28" />
                  <th className="sticky top-[2.75rem] z-10 bg-surface w-12" />
                </tr>
              </thead>
              <tbody>
                {filteredServers.map((server) => (
                  <ServerRow
                    key={server.id}
                    server={server}
                    expanded={expandedIds.has(server.id)}
                    onToggle={() => toggleExpand(server.id)}
                    onEdit={() => navigate(`/mcp/servers/${server.id}`)}
                    onDelete={() => setConfirmDelete(server)}
                    onTryTool={(tool) =>
                      setTryTool({
                        serverId: server.id,
                        serverName: server.name,
                        tool,
                      })
                    }
                    connect={connect}
                    disconnect={disconnect}
                    visibleTools={filterTools(
                      (server.tool_manifest ?? []) as McpToolManifest[],
                      filters.search,
                    )}
                  />
                ))}
              </tbody>
            </table>
          )}

          <StickyPagination
            page={pagination.page}
            totalPages={pagination.totalPages(total)}
            onPageChange={pagination.setPage}
            total={total}
            pageSize={pagination.pageSize}
            onPageSizeChange={pagination.setPageSize}
          />
        </div>

        {/* Test panel — slides in from right */}
        {tryTool && (
          <div className="w-[380px] shrink-0 sticky top-0 h-[calc(100vh-12rem)]">
            <ToolTestPanel
              serverId={tryTool.serverId}
              serverName={tryTool.serverName}
              tool={tryTool.tool}
              onClose={() => setTryTool(null)}
            />
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      <ConfirmDeleteModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="Delete MCP Server"
        description={
          <>
            Delete{' '}
            <span className="font-medium text-text-primary">{confirmDelete?.name}</span>?
            This will remove the server registration.
          </>
        }
        isPending={deleteServer.isPending}
        error={deleteServer.error as Error | null}
      />
    </div>
  );
}
