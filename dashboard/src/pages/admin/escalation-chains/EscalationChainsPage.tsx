import { useState, useMemo } from 'react';
import {
  useRoles,
  useEscalationChains,
  useAddEscalationChain,
  useRemoveEscalationChain,
} from '../../../api/roles';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { SectionLabel } from '../../../components/common/layout/SectionLabel';


export function EscalationChainsPage() {
  const { data: rolesData } = useRoles();
  const { data: chainsData, isLoading } = useEscalationChains();
  const addChain = useAddEscalationChain();
  const removeChain = useRemoveEscalationChain();

  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [newTarget, setNewTarget] = useState('');

  const chains = chainsData?.chains ?? [];

  // Build target counts per source role
  const targetsBySource = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const c of chains) {
      const list = map.get(c.source_role) ?? [];
      list.push(c.target_role);
      map.set(c.source_role, list);
    }
    return map;
  }, [chains]);

  // Merge roles list with any source roles from chains
  const allRoles = useMemo(() => {
    const set = new Set(rolesData?.roles ?? []);
    for (const c of chains) {
      set.add(c.source_role);
      set.add(c.target_role);
    }
    return [...set].sort();
  }, [rolesData, chains]);

  const targets = selectedRole ? (targetsBySource.get(selectedRole) ?? []) : [];

  const handleAdd = () => {
    if (!selectedRole || !newTarget.trim()) return;
    addChain.mutate(
      { source_role: selectedRole, target_role: newTarget.trim() },
      { onSuccess: () => setNewTarget('') },
    );
  };

  const handleRemove = (target: string) => {
    if (!selectedRole) return;
    removeChain.mutate({ source_role: selectedRole, target_role: target });
  };

  return (
    <div>
      <PageHeader title="RBAC | Role Escalations" />
      <p className="text-xs text-text-secondary -mt-6 mb-8">
        Configure which roles can escalate to other roles. Superadmins can escalate to any role implicitly.
      </p>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-10 bg-surface-sunken rounded w-48" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Left — role list */}
          <div>
            <SectionLabel className="mb-4">Roles</SectionLabel>
            {allRoles.length === 0 ? (
              <p className="text-xs text-text-tertiary">No roles found</p>
            ) : (
              <div>
                {allRoles.map((role) => {
                  const count = targetsBySource.get(role)?.length ?? 0;
                  const isSelected = selectedRole === role;
                  const isSuperAdminRole = role === 'superadmin';
                  return (
                    <div
                      key={role}
                      onClick={isSuperAdminRole ? undefined : () => setSelectedRole(role)}
                      role={isSuperAdminRole ? undefined : 'button'}
                      className={`w-full text-left py-3 border-b border-surface-border transition-colors duration-150 flex items-center justify-between ${
                        isSuperAdminRole
                          ? 'pl-0 text-text-tertiary cursor-default'
                          : isSelected
                            ? 'border-l-2 border-l-accent pl-3 text-accent cursor-pointer'
                            : 'pl-0 text-text-secondary hover:text-text-primary cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono">{role}</span>
                        {isSuperAdminRole && (
                          <span className="text-[10px] text-text-tertiary">
                            — all roles
                          </span>
                        )}
                      </div>
                      {!isSuperAdminRole && count > 0 && (
                        <span className="text-[10px] text-text-tertiary bg-surface-sunken px-1.5 py-0.5 rounded-full">
                          {count}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right — targets for selected role */}
          <div className="lg:col-span-2">
            {!selectedRole ? (
              <p className="text-sm text-text-tertiary mt-8">
                Select a role to view its escalation targets.
              </p>
            ) : (
              <div className="space-y-6">
                <div>
                  <SectionLabel className="mb-1">
                    {selectedRole}
                  </SectionLabel>
                  <p className="text-xs text-text-tertiary">Can escalate to:</p>
                </div>

                {targets.length === 0 ? (
                  <p className="text-xs text-text-tertiary">
                    No escalation targets configured for this role.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {targets.map((target) => (
                      <span
                        key={target}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-surface-sunken rounded-full text-text-secondary font-mono"
                      >
                        {target}
                        <button
                          onClick={() => handleRemove(target)}
                          className="text-text-tertiary hover:text-status-error transition-colors"
                          title={`Remove ${target}`}
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {(() => {
                  const available = allRoles.filter(
                    (r) => r !== selectedRole && !targets.includes(r),
                  );
                  if (available.length === 0) return null;
                  return (
                    <div className="flex items-end gap-3 pt-2 border-t border-surface-border">
                      <div className="flex-1">
                        <SectionLabel className="mb-1">Add Target</SectionLabel>
                        <select
                          value={newTarget}
                          onChange={(e) => setNewTarget(e.target.value)}
                          className="select text-xs font-mono w-full"
                        >
                          <option value="">Select a role...</option>
                          {available.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </div>
                      <button
                        onClick={handleAdd}
                        disabled={!newTarget || addChain.isPending}
                        className="btn-primary text-xs"
                      >
                        {addChain.isPending ? 'Adding...' : 'Add'}
                      </button>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
