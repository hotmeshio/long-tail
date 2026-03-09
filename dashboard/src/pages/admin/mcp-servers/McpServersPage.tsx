import { useState } from 'react';
import { ChevronRight, Pencil, Trash2, Plug, Unplug } from 'lucide-react';
import { RowAction, RowActionGroup } from '../../../components/common/RowActions';
import {
  useMcpServers,
  useConnectMcpServer,
  useDisconnectMcpServer,
  useDeleteMcpServer,
} from '../../../api/mcp';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { TimeAgo } from '../../../components/common/TimeAgo';
import { EmptyState } from '../../../components/common/EmptyState';
import { ConfirmDeleteModal } from '../../../components/common/ConfirmDeleteModal';
import type { McpServerRecord, McpToolManifest } from '../../../api/types';
import { PageHeader } from '../../../components/common/PageHeader';
import { ServerFormModal } from './ServerFormModal';
import { TryToolModal } from '../../mcp/TryToolModal';

function isBuiltIn(row: McpServerRecord): boolean {
  return !!(row.metadata as Record<string, unknown> | null)?.builtin
    || !!(row.transport_config as Record<string, unknown> | null)?.builtin;
}

// ── Tool row inside expanded server ──────────────────────────────────────────

function ToolRow({
  tool,
  onTry,
}: {
  tool: McpToolManifest;
  onTry: () => void;
}) {
  const paramCount = Object.keys(tool.inputSchema?.properties ?? {}).length;

  return (
    <tr
      onClick={onTry}
      className="cursor-pointer row-hover"
    >
      <td className="pl-14 pr-6 py-2">
        <code className="text-xs font-mono text-accent-primary">{tool.name}</code>
      </td>
      <td className="px-6 py-2">
        <span className="text-xs text-text-secondary line-clamp-1">
          {tool.description || '\u2014'}
        </span>
      </td>
      <td className="px-6 py-2 text-right">
        <span className="text-xs text-text-tertiary">
          {paramCount} param{paramCount !== 1 ? 's' : ''}
        </span>
      </td>
      <td className="px-6 py-2 w-16">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTry();
          }}
          className="text-[10px] text-accent-primary hover:underline"
        >
          Try
        </button>
      </td>
    </tr>
  );
}

// ── Server row (expandable) ──────────────────────────────────────────────────

function ServerRow({
  server,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onTryTool,
  connect,
  disconnect,
}: {
  server: McpServerRecord;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTryTool: (tool: McpToolManifest) => void;
  connect: ReturnType<typeof useConnectMcpServer>;
  disconnect: ReturnType<typeof useDisconnectMcpServer>;
}) {
  const tools = (server.tool_manifest ?? []) as McpToolManifest[];
  const builtin = isBuiltIn(server);

  return (
    <>
      {/* Server header row */}
      <tr
        onClick={tools.length > 0 ? onToggle : undefined}
        className={`group/row border-b transition-colors duration-100 ${
          tools.length > 0 ? 'cursor-pointer row-hover' : ''
        }`}
      >
        {/* Expand chevron + name */}
        <td className="px-6 py-3.5">
          <div className="flex items-start gap-2">
            <span className={`mt-0.5 transition-transform duration-150 ${expanded ? 'rotate-90' : ''} ${tools.length === 0 ? 'opacity-0' : 'text-text-tertiary'}`}>
              <ChevronRight size={14} />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-text-primary font-medium">{server.name}</p>
              {server.description && (
                <p className="text-xs text-text-tertiary mt-0.5 line-clamp-1">{server.description}</p>
              )}
            </div>
          </div>
        </td>

        {/* Transport */}
        <td className="px-6 py-3.5 w-24">
          <span className="text-xs font-mono text-text-secondary">
            {builtin ? 'built-in' : server.transport_type}
          </span>
        </td>

        {/* Status */}
        <td className="px-6 py-3.5 w-32">
          <StatusBadge status={server.status} />
        </td>

        {/* Tool count */}
        <td className="px-6 py-3.5 w-20">
          <span className="text-xs text-text-tertiary">
            {tools.length} tool{tools.length !== 1 ? 's' : ''}
          </span>
        </td>

        {/* Updated */}
        <td className="px-6 py-3.5 w-28">
          <TimeAgo date={server.updated_at} />
        </td>

        {/* Actions */}
        <td className="px-6 py-3.5 w-28">
          {builtin ? null : (
            <RowActionGroup>
              {server.status === 'connected' ? (
                <RowAction
                  icon={Unplug}
                  title="Disconnect server"
                  onClick={() => disconnect.mutate(server.id)}
                />
              ) : (
                <RowAction
                  icon={Plug}
                  title="Connect server"
                  onClick={() => connect.mutate(server.id)}
                  colorClass="text-text-tertiary hover:text-status-success"
                />
              )}
              <RowAction
                icon={Pencil}
                title="Edit server"
                onClick={onEdit}
              />
              <RowAction
                icon={Trash2}
                title="Delete server"
                onClick={onDelete}
                colorClass="text-text-tertiary hover:text-status-error"
              />
            </RowActionGroup>
          )}
        </td>
      </tr>

      {/* Animated tool panel */}
      {tools.length > 0 && (
        <tr>
          <td colSpan={6} className="p-0 border-0">
            <div
              className="grid transition-[grid-template-rows] duration-200 ease-in-out"
              style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
            >
              <div className="overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-surface-sunken/40">
                      <th className="pl-14 pr-6 py-1.5 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                        Tool
                      </th>
                      <th className="px-6 py-1.5 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                        Description
                      </th>
                      <th className="px-6 py-1.5 text-right text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                        Params
                      </th>
                      <th className="px-6 py-1.5 w-16" />
                    </tr>
                  </thead>
                  <tbody>
                    {tools.map((tool) => (
                      <ToolRow
                        key={`${server.id}:${tool.name}`}
                        tool={tool}
                        onTry={() => onTryTool(tool)}
                      />
                    ))}
                  </tbody>
                </table>
                <div className="h-1 bg-surface-sunken/20" />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export function McpServersPage() {
  const { data, isLoading } = useMcpServers();
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
        <PageHeader title="MCP Servers" />
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
        title="MCP Servers"
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

      {servers.length === 0 ? (
        <EmptyState title="No MCP servers registered" />
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="sticky top-[2.75rem] z-10 bg-surface px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                Name
              </th>
              <th className="sticky top-[2.75rem] z-10 bg-surface px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-24">
                Transport
              </th>
              <th className="sticky top-[2.75rem] z-10 bg-surface px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-32">
                Status
              </th>
              <th className="sticky top-[2.75rem] z-10 bg-surface px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-20">
                Tools
              </th>
              <th className="sticky top-[2.75rem] z-10 bg-surface px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-28">
                Updated
              </th>
              <th className="sticky top-[2.75rem] z-10 bg-surface px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-28" />
            </tr>
          </thead>
          <tbody>
            {servers.map((server) => (
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
