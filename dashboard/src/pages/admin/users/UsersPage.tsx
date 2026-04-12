import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { useUsers, useDeleteUser } from '../../../api/users';
import { useFilterParams } from '../../../hooks/useFilterParams';
import { DataTable, type Column } from '../../../components/common/data/DataTable';
import { StickyPagination } from '../../../components/common/data/StickyPagination';
import { FilterBar, FilterSelect } from '../../../components/common/data/FilterBar';
import { TimestampCell } from '../../../components/common/display/TimestampCell';
import { ConfirmDeleteModal } from '../../../components/common/modal/ConfirmDeleteModal';
import { RowAction, RowActionGroup } from '../../../components/common/layout/RowActions';
import type { LTUserRecord } from '../../../api/types';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { RolePill } from '../../../components/common/display/RolePill';
import { CreateUserModal } from './CreateUserModal';
import { EditUserModal } from './EditUserModal';
import { BotsPage } from '../bots/BotsPage';
import { RolePanel } from './RolePanel';
import { AccountTabToggle, type AccountTab } from './AccountTabToggle';

const statusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'suspended', label: 'Suspended' },
];

const statusDot: Record<string, string> = {
  active: 'bg-status-success',
  inactive: 'bg-text-tertiary',
  suspended: 'bg-status-error',
};

export function UsersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: AccountTab = tabParam === 'service-accounts' ? 'service-accounts' : 'users';

  const handleTabChange = (tab: AccountTab) => {
    if (tab === 'users') {
      setSearchParams({});
    } else {
      setSearchParams({ tab });
    }
  };

  return (
    <div>
      <PageHeader
        title="Accounts"
        actions={<AccountTabToggle active={activeTab} onChange={handleTabChange} />}
      />
      {activeTab === 'users' ? <UserAccountsPanel /> : <BotsPage embedded />}
    </div>
  );
}

function UserAccountsPanel() {
  const { filters, setFilter, pagination } = useFilterParams({
    filters: { status: '' },
  });
  const deleteUser = useDeleteUser();

  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<LTUserRecord | null>(null);
  const [selectedUser, setSelectedUser] = useState<LTUserRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<LTUserRecord | null>(null);

  const { data, isLoading } = useUsers({
    status: filters.status || undefined,
    limit: pagination.pageSize,
    offset: pagination.offset,
  });

  const total = data?.total ?? 0;
  const users = data?.users ?? [];

  const activeUser = useMemo(() => {
    if (!selectedUser) return null;
    return users.find((u) => u.id === selectedUser.id) ?? selectedUser;
  }, [users, selectedUser]);

  const columns: Column<LTUserRecord>[] = [
    {
      key: 'display_name',
      label: 'User',
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${statusDot[row.status] ?? 'bg-status-pending'}`}
            title={row.status}
          />
          <div>
            <p className="text-sm text-text-primary">
              {row.display_name || row.external_id}
            </p>
            {row.email && (
              <p className="text-xs text-text-tertiary">{row.email}</p>
            )}
          </div>
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
        </div>
      ),
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (row) => <TimestampCell date={row.created_at} />,
      className: 'w-44',
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
            icon={Trash2}
            title="Delete user"
            onClick={() => setConfirmDelete(row)}
            colorClass="text-text-tertiary hover:text-status-error"
          />
        </RowActionGroup>
      ),
      className: 'w-16 text-right',
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
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowCreate(true)} className="btn-primary text-xs">
          Add User
        </button>
      </div>

      <FilterBar>
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          options={statusOptions}
        />
      </FilterBar>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Left — users table */}
        <div className="overflow-x-clip">
          <DataTable
            columns={columns}
            data={users}
            keyFn={(row) => row.id}
            isLoading={isLoading}
            emptyMessage="No users found"
            onRowClick={(row) => setSelectedUser(row)}
            activeRowKey={activeUser?.id ?? null}
          />

          <StickyPagination
            page={pagination.page}
            totalPages={pagination.totalPages(total)}
            onPageChange={pagination.setPage}
            total={total}
            pageSize={pagination.pageSize}
            onPageSizeChange={pagination.setPageSize}
          />
        </div>

        {/* Right — role management panel */}
        <RolePanel user={activeUser} />
      </div>

      <CreateUserModal open={showCreate} onClose={() => setShowCreate(false)} />

      <EditUserModal
        open={!!editingUser}
        onClose={() => setEditingUser(null)}
        user={editingUser}
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
