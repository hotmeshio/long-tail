import { useState } from 'react';
import {
  useMcpServers,
  useConnectMcpServer,
  useDisconnectMcpServer,
  useDeleteMcpServer,
} from '../../../api/mcp';
import { DataTable, type Column } from '../../../components/common/DataTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { TimeAgo } from '../../../components/common/TimeAgo';
import { ConfirmDeleteModal } from '../../../components/common/ConfirmDeleteModal';
import type { McpServerRecord } from '../../../api/types';
import { PageHeader } from '../../../components/common/PageHeader';
import { ServerFormModal } from './ServerFormModal';

function isBuiltIn(row: McpServerRecord): boolean {
  return !!(row.metadata as Record<string, unknown> | null)?.builtin;
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

  const columns: Column<McpServerRecord>[] = [
    {
      key: 'name',
      label: 'Name',
      render: (row) => (
        <div>
          <p className="text-sm text-text-primary font-medium">{row.name}</p>
          {row.description && (
            <p className="text-xs text-text-tertiary mt-0.5">{row.description}</p>
          )}
        </div>
      ),
    },
    {
      key: 'transport_type',
      label: 'Transport',
      render: (row) => (
        <span className="text-xs font-mono text-text-secondary">
          {isBuiltIn(row) ? 'built-in' : row.transport_type}
        </span>
      ),
      className: 'w-24',
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
      className: 'w-32',
    },
    {
      key: 'auto_connect',
      label: 'Auto',
      render: (row) => (
        <span className={`text-xs ${row.auto_connect ? 'text-text-primary' : 'text-text-tertiary'}`}>
          {row.auto_connect ? 'Yes' : 'No'}
        </span>
      ),
      className: 'w-16',
    },
    {
      key: 'updated_at',
      label: 'Updated',
      render: (row) => <TimeAgo date={row.updated_at} />,
      className: 'w-28',
    },
    {
      key: 'actions',
      label: '',
      render: (row) => {
        if (isBuiltIn(row)) {
          const toolCount = row.tool_manifest?.length ?? 0;
          return (
            <span className="text-xs text-text-tertiary">
              {toolCount} tool{toolCount !== 1 ? 's' : ''}
            </span>
          );
        }
        return (
          <div className="flex gap-2">
            {row.status === 'connected' ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  disconnect.mutate(row.id);
                }}
                className="btn-ghost text-xs"
                disabled={disconnect.isPending}
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  connect.mutate(row.id);
                }}
                className="btn-ghost text-xs"
                disabled={connect.isPending}
              >
                Connect
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditing(row);
                setShowForm(true);
              }}
              className="text-xs text-accent hover:underline"
            >
              Edit
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(row);
              }}
              className="text-xs text-status-error hover:underline"
            >
              Delete
            </button>
          </div>
        );
      },
      className: 'w-48',
    },
  ];

  const handleDelete = () => {
    if (!confirmDelete) return;
    deleteServer.mutate(confirmDelete.id, {
      onSuccess: () => setConfirmDelete(null),
    });
  };

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

      <DataTable
        columns={columns}
        data={data?.servers ?? []}
        keyFn={(row) => row.id}
        isLoading={isLoading}
        emptyMessage="No MCP servers registered"
      />

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
        description={<>Delete <span className="font-medium text-text-primary">{confirmDelete?.name}</span>? This will remove the server registration.</>}
        isPending={deleteServer.isPending}
        error={deleteServer.error as Error | null}
      />
    </div>
  );
}
