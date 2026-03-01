import { useState } from 'react';
import { useAddUserRole, useRemoveUserRole } from '../../../api/users';
import { useRoles } from '../../../api/roles';
import { Modal } from '../../../components/common/Modal';
import type { LTUserRecord, LTRoleType } from '../../../api/types';

export function RoleManagementModal({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user: LTUserRecord | null;
}) {
  const addRole = useAddUserRole();
  const removeRole = useRemoveUserRole();
  const { data: rolesData } = useRoles();
  const [newRole, setNewRole] = useState('');
  const [newRoleType, setNewRoleType] = useState<LTRoleType>('member');
  const [localRoles, setLocalRoles] = useState(user?.roles ?? []);

  const [prevUser, setPrevUser] = useState(user);
  if (user !== prevUser) {
    setPrevUser(user);
    setLocalRoles(user?.roles ?? []);
    setNewRole('');
    setNewRoleType('member');
  }

  const handleAdd = () => {
    if (!user || !newRole.trim()) return;
    addRole.mutate(
      { userId: user.id, role: newRole.trim(), type: newRoleType },
      {
        onSuccess: () => {
          setLocalRoles((prev) => [
            ...prev,
            { role: newRole.trim(), type: newRoleType, created_at: new Date().toISOString() },
          ]);
          setNewRole('');
          setNewRoleType('member');
        },
      },
    );
  };

  const handleRemove = (roleName: string) => {
    if (!user) return;
    removeRole.mutate(
      { userId: user.id, role: roleName },
      {
        onSuccess: () => {
          setLocalRoles((prev) => prev.filter((r) => r.role !== roleName));
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Roles — ${user?.display_name || user?.external_id || ''}`}
    >
      {user && (
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
              Current Roles
            </p>
            {localRoles.length === 0 ? (
              <p className="text-xs text-text-tertiary">No roles assigned</p>
            ) : (
              <div className="space-y-2">
                {localRoles.map((r) => (
                  <div
                    key={r.role}
                    className="flex items-center justify-between px-3 py-2 bg-surface-sunken rounded-md"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-text-primary">{r.role}</span>
                      <span className="text-[10px] text-text-tertiary">({r.type})</span>
                    </div>
                    <button
                      onClick={() => handleRemove(r.role)}
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

          {(() => {
            const assignedNames = new Set(localRoles.map((r) => r.role));
            const available = (rolesData?.roles ?? []).filter((r) => !assignedNames.has(r));
            if (available.length === 0) return null;
            return (
              <div className="border-t border-surface-border pt-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
                  Add Role
                </p>
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-[10px] text-text-tertiary mb-1">Role</label>
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
                    <label className="block text-[10px] text-text-tertiary mb-1">Type</label>
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
                    onClick={handleAdd}
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
  );
}
