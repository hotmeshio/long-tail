import { useState } from 'react';
import {
  useWorkflowConfigs,
  useDeleteWorkflowConfig,
} from '../../../api/workflows';
import { DataTable, type Column } from '../../../components/common/DataTable';
import { ConfirmDeleteModal } from '../../../components/common/ConfirmDeleteModal';
import type { LTWorkflowConfig } from '../../../api/types';
import { PageHeader } from '../../../components/common/PageHeader';
import { ConfigFormModal } from './ConfigFormModal';

// ── Page ──────────────────────────────────────────────────────────────────────

export function WorkflowConfigsPage() {
  const { data, isLoading } = useWorkflowConfigs();
  const deleteConfig = useDeleteWorkflowConfig();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<LTWorkflowConfig | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const configs = data ?? [];

  const columns: Column<LTWorkflowConfig>[] = [
    {
      key: 'workflow_type',
      label: 'Workflow Type',
      render: (row) => (
        <div>
          <span className="font-mono text-xs">{row.workflow_type}</span>
          {row.description && (
            <p className="text-[10px] text-text-tertiary mt-0.5">{row.description}</p>
          )}
        </div>
      ),
    },
    {
      key: 'task_queue',
      label: 'Task Queue',
      render: (row) => <span className="font-mono text-xs text-text-secondary">{row.task_queue}</span>,
    },
    {
      key: 'is_lt',
      label: 'LT',
      render: (row) => (
        <span className={`text-xs ${row.is_lt ? 'text-text-primary' : 'text-text-tertiary'}`}>
          {row.is_lt ? 'Yes' : 'No'}
        </span>
      ),
      className: 'w-16',
    },
    {
      key: 'is_container',
      label: 'Container',
      render: (row) => (
        <span className={`text-xs ${row.is_container ? 'text-text-primary' : 'text-text-tertiary'}`}>
          {row.is_container ? 'Yes' : 'No'}
        </span>
      ),
      className: 'w-24',
    },
    {
      key: 'invocable',
      label: 'Invocable',
      render: (row) => (
        <span className={`text-xs ${row.invocable ? 'text-text-primary' : 'text-text-tertiary'}`}>
          {row.invocable ? 'Yes' : 'No'}
        </span>
      ),
      className: 'w-24',
    },
    {
      key: 'schemas',
      label: 'Schemas',
      render: (row) => (
        <div className="flex gap-1 flex-wrap">
          {row.envelope_schema && (
            <span className="px-1.5 py-0.5 text-[10px] bg-accent/10 text-accent rounded">env</span>
          )}
          {row.resolver_schema && (
            <span className="px-1.5 py-0.5 text-[10px] bg-accent/10 text-accent rounded">res</span>
          )}
          {row.cron_schedule && (
            <span className="px-1.5 py-0.5 text-[10px] bg-status-warning/10 text-status-warning rounded font-mono">{row.cron_schedule}</span>
          )}
        </div>
      ),
      className: 'w-32',
    },
    {
      key: 'default_role',
      label: 'Default Role',
      render: (row) => <span className="text-xs text-text-secondary">{row.default_role}</span>,
    },
    {
      key: 'roles',
      label: 'Roles',
      render: (row) => (
        <div className="flex gap-1 flex-wrap">
          {(row.roles ?? []).map((r) => (
            <span key={r} className="px-2 py-0.5 text-[10px] bg-surface-sunken rounded-full text-text-secondary">
              {r}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <div className="flex gap-2">
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
              setConfirmDelete(row.workflow_type);
            }}
            className="text-xs text-status-error hover:underline"
          >
            Delete
          </button>
        </div>
      ),
      className: 'w-28 text-right',
    },
  ];

  const handleDelete = () => {
    if (!confirmDelete) return;
    deleteConfig.mutate(confirmDelete, {
      onSuccess: () => setConfirmDelete(null),
    });
  };

  return (
    <div>
      <PageHeader
        title="Workflow Configurations"
        actions={
          <button
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            className="btn-primary text-xs"
          >
            Add Config
          </button>
        }
      />

      <DataTable
        columns={columns}
        data={configs}
        keyFn={(row) => row.workflow_type}
        isLoading={isLoading}
        emptyMessage="No workflow configurations found"
      />

      {/* Create / Edit modal */}
      <ConfigFormModal
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
        title="Delete Workflow Config"
        description={<>Delete <span className="font-mono font-medium text-text-primary">{confirmDelete}</span>? This will cascade-delete associated roles and invocation roles.</>}
        isPending={deleteConfig.isPending}
        error={deleteConfig.error as Error | null}
      />
    </div>
  );
}
