import { useState, useMemo } from 'react';
import { useRoles } from '../../../api/roles';
import { useAddUserRole, useRemoveUserRole } from '../../../api/users';
import type { LTUserRecord, LTRoleType } from '../../../api/types';
import { RolePill } from '../../../components/common/display/RolePill';

export function RolePanel({ user }: { user: LTUserRecord | null }) {
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
