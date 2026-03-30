import { useState, useMemo, useEffect } from 'react';
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
import { useFilterParams } from '../../../hooks/useFilterParams';
import { ServerFormModal } from './ServerFormModal';
import { TryToolModal } from '../../mcp/TryToolModal';
import { matchesSearch, filterTools } from './helpers';
import { ServerRow } from './ServerRow';

export function McpServersPage() {
  const { filters, setFilter } = useFilterParams({
    filters: { status: '', search: '' },
  });

  const { data, isLoading } = useMcpServers({
    status: filters.status || undefined,
    search: filters.search || undefined,
  });
  const connect = useConnectMcpServer();
  const disconnect = useDisconnectMcpServer();
  const deleteServer = useDeleteMcpServer();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<McpServerRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<McpServerRecord | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [tryTool, setTryTool] = useState<{
    serverId: string;
    serverName: string;
    tool: McpToolManifest;
  } | null>(null);

  const servers = data?.servers ?? [];

  // Client-side search filtering for tool-level matches within expanded rows
  const filteredServers = useMemo(() => {
    if (!filters.search) return servers;
    return servers.filter((s) => matchesSearch(s, filters.search));
  }, [servers, filters.search]);

  // Auto-expand servers whose tools match the search (so results are visible)
  useEffect(() => {
    if (!filters.search) return;
    const q = filters.search.toLowerCase();
    const idsToExpand = filteredServers
      .filter((s) => {
        const tools = (s.tool_manifest ?? []) as McpToolManifest[];
        return tools.some(
          (t) => t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q),
        );
      })
      .map((s) => s.id);
    if (idsToExpand.length > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        for (const id of idsToExpand) next.add(id);
        return next;
      });
    }
  }, [filters.search, filteredServers]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = () => {
    if (!confirmDelete) return;
    deleteServer.mutate(confirmDelete.id, {
      onSuccess: () => setConfirmDelete(null),
    });
  };

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Server Tools" />
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
        title="Server Tools"
        actions={
          <button
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            className="btn-primary text-xs"
          >
            Register Server
          </button>
        }
      />

      <p className="text-sm text-text-secondary mb-6 max-w-2xl leading-relaxed">
        Built-in, user-registered, and external MCP servers.
      </p>

      <FilterBar>
        <FilterInput
          label="Search"
          value={filters.search}
          onChange={(v) => setFilter('search', v)}
          placeholder="Server or tool name…"
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

      {filteredServers.length === 0 ? (
        <EmptyState title="No MCP servers found" />
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
            </tr>
          </thead>
          <tbody>
            {filteredServers.map((server) => (
              <ServerRow
                key={server.id}
                server={server}
                expanded={expandedIds.has(server.id)}
                onToggle={() => toggleExpand(server.id)}
                onEdit={() => {
                  setEditing(server);
                  setShowForm(true);
                }}
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

      {/* Create / Edit modal */}
      <ServerFormModal
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setEditing(null);
        }}
        editing={editing}
      />

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

      {/* Try tool modal */}
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
