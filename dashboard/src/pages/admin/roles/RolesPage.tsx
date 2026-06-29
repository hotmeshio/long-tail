import { useState, useMemo } from 'react';
import { Search, Eye, GitBranch, Users, Network, Plus } from 'lucide-react';
import { useRoleDetails, useDeleteRole, type RoleDetail } from '../../../api/roles';
import { ConfirmDeleteModal } from '../../../components/common/modal/ConfirmDeleteModal';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { CreateRoleModal } from './CreateRoleModal';
import { RoleDetailPanel } from './RoleDetailPanel';

// ── Role list row ─────────────────────────────────────────────────────────────

function RoleRow({
  role,
  isSelected,
  onClick,
}: {
  role: RoleDetail;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      className={`group flex items-start gap-3 py-3 px-4 -mx-4 cursor-pointer transition-colors rounded-sm border-l-2 ${
        isSelected ? 'border-accent' : 'border-transparent hover:border-surface-border'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-mono font-medium text-text-primary">{role.role}</span>
          {role.title && (
            <span className="text-xs text-text-secondary">{role.title}</span>
          )}
          {role.ops_visible && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-accent uppercase tracking-wider">
              <Eye className="w-2.5 h-2.5" />ops
            </span>
          )}
        </div>
        {role.description && (
          <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-1">{role.description}</p>
        )}
        <div className="flex items-center gap-3 mt-1">
          {role.user_count > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-text-quaternary">
              <Users className="w-2.5 h-2.5" />{role.user_count}
            </span>
          )}
          {role.chain_count > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-text-quaternary">
              <Network className="w-2.5 h-2.5" />{role.chain_count}
            </span>
          )}
          {role.parent_role && (
            <span className="flex items-center gap-0.5 text-[10px] text-text-quaternary">
              <GitBranch className="w-2.5 h-2.5" />
              <span className="font-mono">{role.parent_role}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function RolesPage() {
  const { data, isLoading } = useRoleDetails();
  const deleteRole = useDeleteRole();

  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RoleDetail | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const roles = data?.roles ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return roles;
    const q = search.toLowerCase();
    return roles.filter(
      (r) =>
        r.role.toLowerCase().includes(q) ||
        r.title?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q),
    );
  }, [roles, search]);

  const handleDelete = () => {
    if (!confirmDelete) return;
    deleteRole.mutate(confirmDelete.role, {
      onSuccess: () => {
        setConfirmDelete(null);
        if (selectedRole === confirmDelete.role) setSelectedRole(null);
      },
    });
  };

  return (
    <div>
      <PageHeader
        title="Roles"
        docsHash="#docs:dashboard.md:roles-and-permissions"
        actions={
          <button onClick={() => setShowCreate(true)} className="btn-primary text-xs flex items-center gap-1.5">
            <Plus className="w-3 h-3" />
            Add Role
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-start">
        {/* Left: role list */}
        <div>
          {/* Sticky search bar */}
          <div className="sticky top-0 z-20 bg-surface pt-3 pb-3">
            <div className="bg-[#F7F7F7] rounded-lg px-5 py-2">
              <div className="relative">
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

          {isLoading ? (
            <div className="animate-pulse space-y-4 mt-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 bg-surface-sunken rounded w-24" />
                  <div className="h-2 bg-surface-sunken rounded w-48" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-text-tertiary mt-6 px-4">
              {search ? 'No roles match your search.' : 'No roles found.'}
            </p>
          ) : (
            <div className="mt-2 divide-y divide-surface-border/30">
              {filtered.map((role) => (
                <RoleRow
                  key={role.role}
                  role={role}
                  isSelected={selectedRole === role.role}
                  onClick={() => setSelectedRole(role.role === selectedRole ? null : role.role)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right: detail panel */}
        <div className="sticky top-4">
          {selectedRole ? (
            <RoleDetailPanel
              selectedRole={selectedRole}
              roles={roles}
              onDelete={setConfirmDelete}
            />
          ) : (
            <div className="border-l border-surface-border pl-6 min-h-[200px]">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">
                Role Detail
              </p>
              <p className="text-xs text-text-tertiary">
                Select a role to view and edit its metadata, escalation chains, form schema, and properties.
              </p>
            </div>
          )}
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
