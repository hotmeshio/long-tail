import { useState, useMemo } from 'react';
import {
  useRoleDetails,
  useCreateRole,
  useDeleteRole,
  useEscalationChains,
  useAddEscalationChain,
  useRemoveEscalationChain,
  type RoleDetail,
} from '../../../api/roles';
import { Trash2 } from 'lucide-react';
import { DataTable, type Column } from '../../../components/common/data/DataTable';
import { ConfirmDeleteModal } from '../../../components/common/modal/ConfirmDeleteModal';
import { Modal } from '../../../components/common/modal/Modal';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { RolePill } from '../../../components/common/display/RolePill';
import { RowAction, RowActionGroup } from '../../../components/common/layout/RowActions';

// ── Create Role Modal ─────────────────────────────────────────

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

// ── Escalation Panel (right sidebar) ──────────────────────────

function EscalationPanel({
  selectedRole,
  allRoles,
}: {
  selectedRole: string | null;
  allRoles: string[];
}) {
  const { data: chainsData } = useEscalationChains();
  const addChain = useAddEscalationChain();
  const removeChain = useRemoveEscalationChain();
  const [newTarget, setNewTarget] = useState('');

  const chains = chainsData?.chains ?? [];

  const targets = useMemo(() => {
    if (!selectedRole) return [];
    return chains.filter((c) => c.source_role === selectedRole).map((c) => c.target_role);
  }, [chains, selectedRole]);

  const available = useMemo(() => {
    if (!selectedRole) return [];
    return allRoles.filter((r) => r !== selectedRole && r !== 'superadmin' && !targets.includes(r));
  }, [allRoles, selectedRole, targets]);

  const handleAdd = () => {
    if (!selectedRole || !newTarget.trim()) return;
    addChain.mutate(
      { source_role: selectedRole, target_role: newTarget.trim() },
      { onSuccess: () => setNewTarget('') },
    );
  };

  const handleRemove = (target: string) => {
    if (!selectedRole) return;
    removeChain.mutate({ source_role: selectedRole, target_role: target });
  };

  const isSuperAdmin = selectedRole === 'superadmin';

  return (
    <div className="border-l border-surface-border pl-6 min-h-[300px]">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-4">
        Escalation Routing
      </p>

      {!selectedRole ? (
        <p className="text-xs text-text-tertiary">
          Select a role to manage its escalation targets.
        </p>
      ) : isSuperAdmin ? (
        <div>
          <p className="text-sm font-mono text-text-primary mb-2">{selectedRole}</p>
          <p className="text-xs text-text-tertiary">
            Superadmins can escalate to any role implicitly.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-mono text-text-primary">{selectedRole}</p>
            <p className="text-[10px] text-text-tertiary mt-0.5">Can escalate to:</p>
          </div>

          {targets.length === 0 ? (
            <p className="text-xs text-text-tertiary">
              No escalation targets configured.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {targets.map((target) => (
                <span
                  key={target}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-surface-sunken rounded-full text-text-secondary font-mono"
                >
                  {target}
                  <button
                    onClick={() => handleRemove(target)}
                    className="text-text-tertiary hover:text-status-error transition-colors"
                    title={`Remove ${target}`}
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}

          {available.length > 0 && (
            <div className="pt-3 border-t border-surface-border">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
                Add Target
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={newTarget}
                  onChange={(e) => setNewTarget(e.target.value)}
                  className="select text-xs font-mono flex-1"
                >
                  <option value="">Select a role...</option>
                  {available.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <button
                  onClick={handleAdd}
                  disabled={!newTarget || addChain.isPending}
                  className="btn-primary text-xs"
                >
                  {addChain.isPending ? 'Adding...' : 'Add'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────

export function RolesPage() {
  const { data, isLoading } = useRoleDetails();
  const deleteRole = useDeleteRole();

  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RoleDetail | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

  const roles = data?.roles ?? [];
  const allRoleNames = useMemo(() => roles.map((r) => r.role), [roles]);

  const columns: Column<RoleDetail>[] = [
    {
      key: 'role',
      label: 'Role',
      render: (row) => <RolePill role={row.role} />,
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
      label: 'Escalations',
      render: (row) =>
        row.chain_count > 0
          ? <span className="text-text-primary">{row.chain_count}</span>
          : <span className="text-text-tertiary">0</span>,
      className: 'w-28 text-right',
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
        if (inUse) return null;
        return (
          <RowActionGroup>
            <RowAction
              icon={Trash2}
              title="Delete role"
              onClick={() => setConfirmDelete(row)}
              colorClass="text-text-tertiary hover:text-status-error"
            />
          </RowActionGroup>
        );
      },
      className: 'w-16 text-right',
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
        title="Roles"
        actions={
          <button onClick={() => setShowCreate(true)} className="btn-primary text-xs">
            Add Role
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Left — roles table */}
        <div>
          <DataTable
            columns={columns}
            data={roles}
            keyFn={(row) => row.role}
            isLoading={isLoading}
            emptyMessage="No roles found"
            onRowClick={(row) => setSelectedRole(row.role)}
            activeRowKey={selectedRole}
          />
        </div>

        {/* Right — escalation panel */}
        <EscalationPanel selectedRole={selectedRole} allRoles={allRoleNames} />
      </div>

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
