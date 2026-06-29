import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
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
  const [search, setSearch] = useState('');

  const roles = data?.roles ?? [];
  const allRoleNames = useMemo(() => roles.map((r) => r.role), [roles]);

  const filtered = useMemo(() => {
    if (!search.trim()) return roles;
    const q = search.toLowerCase();
    return roles.filter((r) => r.role.toLowerCase().includes(q));
  }, [roles, search]);

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
        docsHash="#docs:dashboard.md:roles-and-permissions"
        actions={
          <button onClick={() => setShowCreate(true)} className="btn-primary text-xs">
            Add Role
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        <div>
          {/* Sticky search bar */}
          <div className="sticky top-0 z-20 bg-surface pt-3 pb-3">
            <div className="bg-[#F7F7F7] rounded-lg px-5 py-2">
              <div className="relative w-1/2">
                <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-3 text-text-quaternary" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${roles.length} roles…`}
                  className="w-full pl-5 py-1 text-sm bg-transparent border-b border-surface-border/60 text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-accent/50 transition-colors"
                />
              </div>
            </div>
          </div>

          <DataTable
            columns={columns}
            data={filtered}
            keyFn={(row) => row.role}
            isLoading={isLoading}
            emptyMessage="No roles found"
            onRowClick={(row) => setSelectedRole(row.role)}
            activeRowKey={selectedRole}
          />
        </div>

        <div className="sticky top-4">
          <EscalationPanel selectedRole={selectedRole} allRoles={allRoleNames} />
        </div>
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
