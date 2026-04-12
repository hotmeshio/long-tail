import { useState, useMemo } from 'react';
import {
  useEscalationChains,
  useAddEscalationChain,
  useRemoveEscalationChain,
} from '../../../api/roles';

export function EscalationPanel({
  selectedRole,
  allRoles,
}: {
  selectedRole: string | null;
  allRoles: string[];
}) {
  const { data: chainsData } = useEscalationChains();
  const addChain = useAddEscalationChain();
  const removeChain = useRemoveEscalationChain();
  const [newTarget, setNewTarget] = useState('');

  const chains = chainsData?.chains ?? [];

  const targets = useMemo(() => {
    if (!selectedRole) return [];
    return chains.filter((c) => c.source_role === selectedRole).map((c) => c.target_role);
  }, [chains, selectedRole]);

  const available = useMemo(() => {
    if (!selectedRole) return [];
    return allRoles.filter((r) => r !== selectedRole && r !== 'superadmin' && !targets.includes(r));
  }, [allRoles, selectedRole, targets]);

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

  const isSuperAdmin = selectedRole === 'superadmin';

  return (
    <div className="border-l border-surface-border pl-6 min-h-[300px]">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-4">
        Escalation Routing
      </p>

      {!selectedRole ? (
        <p className="text-xs text-text-tertiary">
          Select a role to manage its escalation targets.
        </p>
      ) : isSuperAdmin ? (
        <div>
          <p className="text-sm font-mono text-text-primary mb-2">{selectedRole}</p>
          <p className="text-xs text-text-tertiary">
            Superadmins can escalate to any role implicitly.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-mono text-text-primary">{selectedRole}</p>
            <p className="text-[10px] text-text-tertiary mt-0.5">Can escalate to:</p>
          </div>

          {targets.length === 0 ? (
            <p className="text-xs text-text-tertiary">
              No escalation targets configured.
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

          {available.length > 0 && (
            <div className="pt-3 border-t border-surface-border">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
                Add Target
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={newTarget}
                  onChange={(e) => setNewTarget(e.target.value)}
                  className="select text-xs font-mono flex-1"
                >
                  <option value="">Select a role...</option>
                  {available.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <button
                  onClick={handleAdd}
                  disabled={!newTarget || addChain.isPending}
                  className="btn-primary text-xs"
                >
                  {addChain.isPending ? 'Adding...' : 'Add'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
