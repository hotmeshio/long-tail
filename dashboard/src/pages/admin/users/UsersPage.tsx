import { useState } from 'react';
import { Pencil, Shield, Trash2 } from 'lucide-react';
import { useUsers, useDeleteUser } from '../../../api/users';
import { useFilterParams } from '../../../hooks/useFilterParams';
import { DataTable, type Column } from '../../../components/common/data/DataTable';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { StickyPagination } from '../../../components/common/data/StickyPagination';
import { FilterBar, FilterSelect } from '../../../components/common/data/FilterBar';
import { TimeAgo } from '../../../components/common/display/TimeAgo';
import { ConfirmDeleteModal } from '../../../components/common/modal/ConfirmDeleteModal';
import { RowAction, RowActionGroup } from '../../../components/common/layout/RowActions';
import type { LTUserRecord } from '../../../api/types';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { RolePill } from '../../../components/common/display/RolePill';
import { CreateUserModal } from './CreateUserModal';
import { EditUserModal } from './EditUserModal';
import { RoleManagementModal } from './RoleManagementModal';

const statusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'suspended', label: 'Suspended' },
];

export function UsersPage() {
  const { filters, setFilter, pagination } = useFilterParams({
    filters: { status: '' },
  });
  const deleteUser = useDeleteUser();

  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<LTUserRecord | null>(null);
  const [rolesUser, setRolesUser] = useState<LTUserRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<LTUserRecord | null>(null);

  const { data, isLoading } = useUsers({
    status: filters.status || undefined,
    limit: pagination.pageSize,
    offset: pagination.offset,
  });

  const total = data?.total ?? 0;

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
      key: 'status',
      label: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
      className: 'w-28',
    },
    {
      key: 'roles',
      label: 'Roles',
      render: (row) => (
        <div className="flex gap-1 flex-wrap">
          {(row.roles ?? []).map((r) => (
            <RolePill key={r.role} role={r.role} />
          ))}
        </div>
      ),
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (row) => <TimeAgo date={row.created_at} />,
      className: 'w-28',
    },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <RowActionGroup>
          <RowAction
            icon={Pencil}
            title="Edit user"
            onClick={() => setEditingUser(row)}
          />
          <RowAction
            icon={Shield}
            title="Manage roles"
            onClick={() => setRolesUser(row)}
          />
          <RowAction
            icon={Trash2}
            title="Delete user"
            onClick={() => setConfirmDelete(row)}
            colorClass="text-text-tertiary hover:text-status-error"
          />
        </RowActionGroup>
      ),
      className: 'w-24 text-right',
    },
  ];

  const handleDelete = () => {
    if (!confirmDelete) return;
    deleteUser.mutate(confirmDelete.id, {
      onSuccess: () => setConfirmDelete(null),
    });
  };

  return (
    <div>
      <PageHeader
        title="RBAC | Users"
        actions={
          <button onClick={() => setShowCreate(true)} className="btn-primary text-xs">
            Add User
          </button>
        }
      />

      <FilterBar>
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          options={statusOptions}
        />
      </FilterBar>

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

      <CreateUserModal open={showCreate} onClose={() => setShowCreate(false)} />

      <EditUserModal
        open={!!editingUser}
        onClose={() => setEditingUser(null)}
        user={editingUser}
      />

      <RoleManagementModal
        open={!!rolesUser}
        onClose={() => setRolesUser(null)}
        user={rolesUser}
      />

      <ConfirmDeleteModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="Delete User"
        description={
          <>
            Delete{' '}
            <span className="font-medium text-text-primary">
              {confirmDelete?.display_name || confirmDelete?.external_id}
            </span>
            ? This action cannot be undone.
          </>
        }
        isPending={deleteUser.isPending}
        error={deleteUser.error as Error | null}
      />
    </div>
  );
}
