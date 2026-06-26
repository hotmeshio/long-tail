import { useState } from 'react';
import { useUsers, useAddUserRole, useRemoveUserRole } from '../../../api/users';
import { useRoles } from '../../../api/roles';
import { useFilterParams } from '../../../hooks/useFilterParams';
import { DataTable, type Column } from '../../../components/common/data/DataTable';
import { StickyPagination } from '../../../components/common/data/StickyPagination';
import { Modal } from '../../../components/common/modal/Modal';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { RolePill } from '../../../components/common/display/RolePill';
import { ScopeBadge } from '../../../components/common/display/ScopeBadge';
import {
  SCOPE_PRESETS,
  DEFAULT_SCOPE_VALUE,
  scopePreset,
} from '../../../lib/roleScope';
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
  // Work-surface scope only applies to `member`; admin/superadmin act on all.
  const [newScope, setNewScope] = useState(DEFAULT_SCOPE_VALUE);

  const total = data?.total ?? 0;

  const handleAddRole = () => {
    if (!editingUser || !newRole.trim()) return;
    const preset = newRoleType === 'member' ? scopePreset(newScope) : scopePreset(DEFAULT_SCOPE_VALUE);
    addRole.mutate(
      {
        userId: editingUser.id,
        role: newRole.trim(),
        type: newRoleType,
        read_scope: preset.read_scope,
        write_scope: preset.write_scope,
      },
      {
        onSuccess: () => {
          setNewRole('');
          setNewRoleType('member');
          setNewScope(DEFAULT_SCOPE_VALUE);
          setEditingUser((prev) =>
            prev
              ? {
                  ...prev,
                  roles: [
                    ...(prev.roles ?? []),
                    {
                      role: newRole.trim(),
                      type: newRoleType,
                      read_scope: preset.read_scope,
                      write_scope: preset.write_scope,
                      created_at: new Date().toISOString(),
                    },
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
            <RolePill key={r.role} role={r.role} />
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
      <PageHeader title="Roles & Permissions" />

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
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-sm font-mono text-text-primary w-28 shrink-0 truncate" title={r.role}>
                          {r.role}
                        </span>
                        <span className="w-14 shrink-0 text-[9px] uppercase tracking-wide text-text-tertiary">{r.type}</span>
                        {r.type === 'member' && (
                          <>
                            <span className="w-px h-3 bg-surface-border shrink-0" aria-hidden />
                            <ScopeBadge read={r.read_scope} write={r.write_scope} />
                          </>
                        )}
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
                    {newRoleType === 'member' && (
                      <div>
                        <label className="block text-[10px] text-text-tertiary mb-1">
                          Scope
                        </label>
                        <select
                          value={newScope}
                          onChange={(e) => setNewScope(e.target.value)}
                          className="select text-xs"
                        >
                          {SCOPE_PRESETS.map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
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
