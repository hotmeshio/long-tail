import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pencil, Trash2, User, Bot } from 'lucide-react';
import { useUsers, useDeleteUser, useAddUserRole, useRemoveUserRole } from '../../../api/users';
import { useRoles } from '../../../api/roles';
import { useFilterParams } from '../../../hooks/useFilterParams';
import { DataTable, type Column } from '../../../components/common/data/DataTable';
import { StickyPagination } from '../../../components/common/data/StickyPagination';
import { FilterBar, FilterSelect } from '../../../components/common/data/FilterBar';
import { TimeAgo } from '../../../components/common/display/TimeAgo';
import { ConfirmDeleteModal } from '../../../components/common/modal/ConfirmDeleteModal';
import { RowAction, RowActionGroup } from '../../../components/common/layout/RowActions';
import type { LTUserRecord, LTRoleType } from '../../../api/types';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { RolePill } from '../../../components/common/display/RolePill';
import { CreateUserModal } from './CreateUserModal';
import { EditUserModal } from './EditUserModal';
import { BotsPage } from '../bots/BotsPage';

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

// ── Role Panel (right sidebar) ─────────────────────────────────

function RolePanel({ user }: { user: LTUserRecord | null }) {
  const { data: allRolesData } = useRoles();
  const addRole = useAddUserRole();
  const removeRole = useRemoveUserRole();
  const [newRole, setNewRole] = useState('');
  const [newType, setNewType] = useState<LTRoleType>('member');

  const allRoles = allRolesData?.roles ?? [];
  const currentRoles = user?.roles ?? [];

  const available = useMemo(() => {
    const assigned = new Set(currentRoles.map((r) => r.role));
    return allRoles.filter((r) => !assigned.has(r));
  }, [allRoles, currentRoles]);

  const handleAdd = () => {
    if (!user || !newRole.trim()) return;
    addRole.mutate(
      { userId: user.id, role: newRole.trim(), type: newType },
      { onSuccess: () => { setNewRole(''); setNewType('member'); } },
    );
  };

  const handleRemove = (role: string) => {
    if (!user) return;
    removeRole.mutate({ userId: user.id, role });
  };

  return (
    <div className="border-l border-surface-border pl-6 pt-4 min-h-[300px]">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-4">
        Role Membership
      </p>

      {!user ? (
        <p className="text-xs text-text-tertiary">
          Select a user to manage their roles.
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-sm text-text-primary">{user.display_name || user.external_id}</p>
            <p className="text-[10px] text-text-tertiary mt-0.5">Member of:</p>
          </div>

          {currentRoles.length === 0 ? (
            <p className="text-xs text-text-tertiary">No roles assigned.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {currentRoles.map((r) => (
                <span
                  key={r.role}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-surface-sunken rounded-full text-text-secondary"
                >
                  <RolePill role={r.role} />
                  <span className="text-[9px] text-text-tertiary">{r.type}</span>
                  <button
                    onClick={() => handleRemove(r.role)}
                    className="text-text-tertiary hover:text-status-error transition-colors ml-0.5"
                    title={`Remove ${r.role}`}
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
                Add Role
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="select text-xs font-mono flex-1"
                >
                  <option value="">Select a role...</option>
                  {available.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as LTRoleType)}
                  className="select text-xs w-24"
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                  <option value="superadmin">superadmin</option>
                </select>
                <button
                  onClick={handleAdd}
                  disabled={!newRole || addRole.isPending}
                  className="btn-primary text-xs"
                >
                  {addRole.isPending ? '...' : 'Add'}
                </button>
              </div>
              {addRole.error && (
                <p className="text-[10px] text-status-error mt-1">{(addRole.error as Error).message}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab toggle ─────────────────────────────────────────────────

type AccountTab = 'users' | 'service-accounts';

function AccountTabToggle({ active, onChange }: { active: AccountTab; onChange: (t: AccountTab) => void }) {
  const btn = (tab: AccountTab, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => onChange(tab)}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
        active === tab
          ? 'bg-accent/10 text-accent font-medium'
          : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-hover'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="flex gap-1 p-0.5 bg-surface-sunken rounded-lg w-fit">
      {btn('users', <User className="w-3.5 h-3.5" />, 'User Accounts')}
      {btn('service-accounts', <Bot className="w-3.5 h-3.5" />, 'Service Accounts')}
    </div>
  );
}

// ── Accounts Page (wrapper) ────────────────────────────────────

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

// ── User Accounts Panel ────────────────────────────────────────

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

  // Keep selected user in sync with refreshed data
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
        <div>
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
