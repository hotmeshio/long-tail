import { useState } from 'react';
import { useRoleDetails, useCreateRole, useDeleteRole, type RoleDetail } from '../../../api/roles';
import { DataTable, type Column } from '../../../components/common/DataTable';
import { ConfirmDeleteModal } from '../../../components/common/ConfirmDeleteModal';
import { Modal } from '../../../components/common/Modal';
import { PageHeader } from '../../../components/common/PageHeader';

function CreateRoleModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const createRole = useCreateRole();
  const [roleName, setRoleName] = useState('');

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setRoleName('');
      createRole.reset();
    }
  }

  const handleCreate = () => {
    const trimmed = roleName.trim().toLowerCase();
    if (!trimmed) return;
    createRole.mutate(trimmed, { onSuccess: onClose });
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Role">
      <div className="space-y-4">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Role Name (required)
          </label>
          <input
            type="text"
            value={roleName}
            onChange={(e) => setRoleName(e.target.value)}
            placeholder="e.g., reviewer"
            className="input text-xs w-full"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
          />
          <p className="text-[10px] text-text-tertiary mt-1">
            Lowercase letters, numbers, hyphens, and underscores only.
          </p>
        </div>

        {createRole.error && (
          <p className="text-xs text-status-error">{(createRole.error as Error).message}</p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary text-xs">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!roleName.trim() || createRole.isPending}
            className="btn-primary text-xs"
          >
            {createRole.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function RolesPage() {
  const { data, isLoading } = useRoleDetails();
  const deleteRole = useDeleteRole();

  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RoleDetail | null>(null);

  const columns: Column<RoleDetail>[] = [
    {
      key: 'role',
      label: 'Role',
      render: (row) => (
        <span className="font-mono text-sm text-text-primary">{row.role}</span>
      ),
    },
    {
      key: 'user_count',
      label: 'Users',
      render: (row) =>
        row.user_count > 0
          ? <span className="text-text-primary">{row.user_count}</span>
          : <span className="text-text-tertiary">0</span>,
      className: 'w-24 text-right',
    },
    {
      key: 'chain_count',
      label: 'Escalation Chains',
      render: (row) =>
        row.chain_count > 0
          ? <span className="text-text-primary">{row.chain_count}</span>
          : <span className="text-text-tertiary">0</span>,
      className: 'w-36 text-right',
    },
    {
      key: 'workflow_count',
      label: 'Workflows',
      render: (row) =>
        row.workflow_count > 0
          ? <span className="text-text-primary">{row.workflow_count}</span>
          : <span className="text-text-tertiary">0</span>,
      className: 'w-28 text-right',
    },
    {
      key: 'actions',
      label: '',
      render: (row) => {
        const inUse = row.user_count > 0 || row.chain_count > 0 || row.workflow_count > 0;
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(row);
            }}
            disabled={inUse}
            className={`text-xs ${
              inUse
                ? 'text-text-tertiary cursor-not-allowed'
                : 'text-status-error hover:underline'
            }`}
            title={inUse ? 'Cannot delete a role that is in use' : 'Delete role'}
          >
            Delete
          </button>
        );
      },
      className: 'w-24 text-right',
    },
  ];

  const handleDelete = () => {
    if (!confirmDelete) return;
    deleteRole.mutate(confirmDelete.role, {
      onSuccess: () => setConfirmDelete(null),
    });
  };

  return (
    <div>
      <PageHeader
        title="RBAC | Roles"
        actions={
          <button onClick={() => setShowCreate(true)} className="btn-primary text-xs">
            Add Role
          </button>
        }
      />

      <DataTable
        columns={columns}
        data={data?.roles ?? []}
        keyFn={(row) => row.role}
        isLoading={isLoading}
        emptyMessage="No roles found"
      />

      <CreateRoleModal open={showCreate} onClose={() => setShowCreate(false)} />

      <ConfirmDeleteModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="Delete Role"
        description={
          <>
            Delete role{' '}
            <span className="font-medium font-mono text-text-primary">
              {confirmDelete?.role}
            </span>
            ? This action cannot be undone.
          </>
        }
        isPending={deleteRole.isPending}
        error={deleteRole.error as Error | null}
      />
    </div>
  );
}
