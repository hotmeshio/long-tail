import { useState, useMemo } from 'react';
import { useRoleDetails, useDeleteRole, type RoleDetail } from '../../../api/roles';
import { DataTable } from '../../../components/common/data/DataTable';
import { ConfirmDeleteModal } from '../../../components/common/modal/ConfirmDeleteModal';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { CreateRoleModal } from './CreateRoleModal';
import { EscalationPanel } from './EscalationPanel';
import { getRoleColumns } from './RoleColumns';

export function RolesPage() {
  const { data, isLoading } = useRoleDetails();
  const deleteRole = useDeleteRole();

  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RoleDetail | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

  const roles = data?.roles ?? [];
  const allRoleNames = useMemo(() => roles.map((r) => r.role), [roles]);

  const columns = getRoleColumns((row) => setConfirmDelete(row));

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
