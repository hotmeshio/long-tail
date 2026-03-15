import { useState } from 'react';
import { useUsers, useAddUserRole, useRemoveUserRole } from '../../../api/users';
import { useRoles } from '../../../api/roles';
import { useFilterParams } from '../../../hooks/useFilterParams';
import { DataTable, type Column } from '../../../components/common/data/DataTable';
import { StickyPagination } from '../../../components/common/data/StickyPagination';
import { Modal } from '../../../components/common/modal/Modal';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import type { LTUserRecord, LTRoleType } from '../../../api/types';

export function UserRolesPage() {
  const { pagination } = useFilterParams();
  const { data, isLoading } = useUsers({
    limit: pagination.pageSize,
    offset: pagination.offset,
  });
  const addRole = useAddUserRole();
  const removeRole = useRemoveUserRole();
  const { data: rolesData } = useRoles();

  const [editingUser, setEditingUser] = useState<LTUserRecord | null>(null);
  const [newRole, setNewRole] = useState('');
  const [newRoleType, setNewRoleType] = useState<LTRoleType>('member');

  const total = data?.total ?? 0;

  const handleAddRole = () => {
    if (!editingUser || !newRole.trim()) return;
    addRole.mutate(
      { userId: editingUser.id, role: newRole.trim(), type: newRoleType },
      {
        onSuccess: () => {
          setNewRole('');
          setNewRoleType('member');
          setEditingUser((prev) =>
            prev
              ? {
                  ...prev,
                  roles: [
                    ...(prev.roles ?? []),
                    { role: newRole.trim(), type: newRoleType, created_at: new Date().toISOString() },
                  ],
                }
              : null,
          );
        },
      },
    );
  };

  const handleRemoveRole = (userId: string, roleName: string) => {
    removeRole.mutate(
      { userId, role: roleName },
      {
        onSuccess: () => {
          setEditingUser((prev) =>
            prev
              ? {
                  ...prev,
                  roles: (prev.roles ?? []).filter((r) => r.role !== roleName),
                }
              : null,
          );
        },
      },
    );
  };

  const columns: Column<LTUserRecord>[] = [
    {
      key: 'display_name',
      label: 'User',
      render: (row) => (
        <div>
          <p className="text-sm text-text-primary">
            {row.display_name || row.external_id}
          </p>
          {row.email && (
            <p className="text-xs text-text-tertiary">{row.email}</p>
          )}
        </div>
      ),
    },
    {
      key: 'roles',
      label: 'Roles',
      render: (row) => (
        <div className="flex gap-1 flex-wrap">
          {(row.roles ?? []).map((r) => (
            <span
              key={r.role}
              className="px-2 py-0.5 text-[10px] bg-surface-sunken rounded-full text-text-secondary"
            >
              {r.role}
              <span className="text-text-tertiary ml-1">({r.type})</span>
            </span>
          ))}
          {(row.roles ?? []).length === 0 && (
            <span className="text-[10px] text-text-tertiary">No roles</span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setEditingUser(row);
          }}
          className="text-xs text-accent hover:underline"
        >
          Edit Roles
        </button>
      ),
      className: 'w-24 text-right',
    },
  ];

  return (
    <div>
      <PageHeader title="User Roles" />

      <DataTable
        columns={columns}
        data={data?.users ?? []}
        keyFn={(row) => row.id}
        isLoading={isLoading}
        emptyMessage="No users found"
      />

      <StickyPagination
        page={pagination.page}
        totalPages={pagination.totalPages(total)}
        onPageChange={pagination.setPage}
        total={total}
        pageSize={pagination.pageSize}
        onPageSizeChange={pagination.setPageSize}
      />

      {/* Edit roles modal */}
      <Modal
        open={!!editingUser}
        onClose={() => setEditingUser(null)}
        title={`Roles — ${editingUser?.display_name || editingUser?.external_id || ''}`}
      >
        {editingUser && (
          <div className="space-y-4">
            {/* Current roles */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
                Current Roles
              </p>
              {(editingUser.roles ?? []).length === 0 ? (
                <p className="text-xs text-text-tertiary">No roles assigned</p>
              ) : (
                <div className="space-y-2">
                  {(editingUser.roles ?? []).map((r) => (
                    <div
                      key={r.role}
                      className="flex items-center justify-between px-3 py-2 bg-surface-sunken rounded-md"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-text-primary">
                          {r.role}
                        </span>
                        <span className="text-[10px] text-text-tertiary">
                          ({r.type})
                        </span>
                      </div>
                      <button
                        onClick={() => handleRemoveRole(editingUser.id, r.role)}
                        className="text-[10px] text-status-error hover:underline"
                        disabled={removeRole.isPending}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add role form */}
            {(() => {
              const assignedNames = new Set((editingUser.roles ?? []).map((r) => r.role));
              const available = (rolesData?.roles ?? []).filter((r) => !assignedNames.has(r));
              if (available.length === 0) return null;
              return (
                <div className="border-t border-surface-border pt-4">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
                    Add Role
                  </p>
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <label className="block text-[10px] text-text-tertiary mb-1">
                        Role
                      </label>
                      <select
                        value={newRole}
                        onChange={(e) => setNewRole(e.target.value)}
                        className="select text-xs w-full"
                      >
                        <option value="">Select a role...</option>
                        {available.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-text-tertiary mb-1">
                        Type
                      </label>
                      <select
                        value={newRoleType}
                        onChange={(e) => setNewRoleType(e.target.value as LTRoleType)}
                        className="select text-xs"
                      >
                        <option value="member">member</option>
                        <option value="admin">admin</option>
                        <option value="superadmin">superadmin</option>
                      </select>
                    </div>
                    <button
                      onClick={handleAddRole}
                      disabled={!newRole || addRole.isPending}
                      className="btn-primary text-xs"
                    >
                      {addRole.isPending ? 'Adding...' : 'Add'}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </Modal>
    </div>
  );
}
