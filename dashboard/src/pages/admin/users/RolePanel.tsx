import { useState, useMemo } from 'react';
import { Drama } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useRoles } from '../../../api/roles';
import { useAddUserRole, useRemoveUserRole } from '../../../api/users';
import {
  usePersonas,
  useUserPersonas,
  useAssignPersona,
  useUnassignPersona,
} from '../../../api/personas';
import type { LTUserRecord, LTRoleType } from '../../../api/types';
import { RolePill } from '../../../components/common/display/RolePill';
import { ScopeBadge } from '../../../components/common/display/ScopeBadge';
import {
  SCOPE_PRESETS,
  DEFAULT_SCOPE_VALUE,
  scopePreset,
} from '../../../lib/roleScope';

/**
 * Persona assignment for the selected user. A persona is shorthand for scoped
 * role memberships — assigning one composes the user's whole surface; the
 * membership list below reflects the fan-out (rows marked with the sustaining
 * persona's key).
 */
function PersonaBlock({ user }: { user: LTUserRecord }) {
  const { data: allPersonas } = usePersonas();
  const { data: held } = useUserPersonas(user.id);
  const assign = useAssignPersona();
  const unassign = useUnassignPersona();
  const [newPersona, setNewPersona] = useState('');

  const heldPersonas = held?.personas ?? [];
  const available = useMemo(() => {
    const keys = new Set(heldPersonas.map((p) => p.key));
    return (allPersonas?.personas ?? []).filter((p) => !keys.has(p.key));
  }, [allPersonas, heldPersonas]);

  if (heldPersonas.length === 0 && available.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
        Personas
      </p>
      {heldPersonas.length > 0 && (
        <div className="flex flex-col gap-2">
          {heldPersonas.map((p) => (
            <span
              key={p.key}
              className="flex items-center gap-2.5 w-full min-w-0 pl-2.5 pr-2 py-1 text-xs bg-surface-sunken rounded-full text-text-secondary"
            >
              <Drama className="w-3 h-3 shrink-0 text-text-tertiary" aria-hidden />
              <Link
                to={`/admin/personas/${encodeURIComponent(p.key)}`}
                className="flex-1 min-w-0 truncate transition-colors hover:text-accent"
                title={p.key}
              >
                {p.title || p.key}
              </Link>
              <span className="shrink-0 text-2xs text-text-tertiary tabular-nums">
                {p.roles.length} role{p.roles.length === 1 ? '' : 's'}
              </span>
              <button
                onClick={() => unassign.mutate({ userId: user.id, key: p.key })}
                className="shrink-0 text-text-tertiary hover:text-status-error transition-colors ml-1"
                title={`Unassign ${p.title || p.key}`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <div className="flex gap-2">
          <select
            value={newPersona}
            onChange={(e) => setNewPersona(e.target.value)}
            className="select text-xs w-full min-w-0"
            aria-label="Persona"
          >
            <option value="">Assign a persona...</option>
            {available.map((p) => (
              <option key={p.key} value={p.key}>{p.title || p.key}</option>
            ))}
          </select>
          <button
            onClick={() => {
              if (!newPersona) return;
              assign.mutate(
                { userId: user.id, key: newPersona },
                { onSuccess: () => setNewPersona('') },
              );
            }}
            disabled={!newPersona || assign.isPending}
            className="btn-primary text-xs shrink-0"
          >
            {assign.isPending ? '...' : 'Assign'}
          </button>
        </div>
      )}
      {(assign.error || unassign.error) && (
        <p className="text-2xs text-status-error">
          {((assign.error || unassign.error) as Error).message}
        </p>
      )}
    </div>
  );
}

export function RolePanel({ user }: { user: LTUserRecord | null }) {
  const { data: allRolesData } = useRoles();
  const addRole = useAddUserRole();
  const removeRole = useRemoveUserRole();
  const [newRole, setNewRole] = useState('');
  const [newType, setNewType] = useState<LTRoleType>('member');
  // Work-surface scope applies to `member`; admin/superadmin act on the whole queue.
  const [newScope, setNewScope] = useState(DEFAULT_SCOPE_VALUE);

  const allRoles = allRolesData?.roles ?? [];
  const currentRoles = user?.roles ?? [];

  const available = useMemo(() => {
    const assigned = new Set(currentRoles.map((r) => r.role));
    return allRoles.filter((r) => !assigned.has(r));
  }, [allRoles, currentRoles]);

  const handleAdd = () => {
    if (!user || !newRole.trim()) return;
    const preset = newType === 'member' ? scopePreset(newScope) : scopePreset(DEFAULT_SCOPE_VALUE);
    addRole.mutate(
      {
        userId: user.id,
        role: newRole.trim(),
        type: newType,
        read_scope: preset.read_scope,
        write_scope: preset.write_scope,
      },
      { onSuccess: () => { setNewRole(''); setNewType('member'); setNewScope(DEFAULT_SCOPE_VALUE); } },
    );
  };

  const handleRemove = (role: string) => {
    if (!user) return;
    removeRole.mutate({ userId: user.id, role });
  };

  return (
    <div className="border-l border-surface-border pl-6 pt-4 min-h-[300px]">
      <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-4">
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
          </div>

          <PersonaBlock user={user} />

          <p className="text-2xs text-text-tertiary">Member of:</p>

          {currentRoles.length === 0 ? (
            <p className="text-xs text-text-tertiary">No roles assigned.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {currentRoles.map((r) => (
                <span
                  key={r.role}
                  className="flex items-center gap-2.5 w-full min-w-0 pl-2.5 pr-2 py-1 text-xs bg-surface-sunken rounded-full text-text-secondary"
                >
                  {/* The universal role pill leads and truncates; the fixed
                      facts (type, scope, remove) keep their width so columns
                      align across stacked rows. */}
                  <span className="flex-1 min-w-0 truncate" title={r.role}>
                    <RolePill role={r.role} tone="inherit" />
                  </span>
                  <span className="w-14 shrink-0 text-2xs uppercase tracking-wide text-text-tertiary">{r.type}</span>
                  {r.type === 'member' && (
                    <>
                      <span className="w-px h-3 bg-surface-border shrink-0" aria-hidden />
                      <ScopeBadge read={r.read_scope} write={r.write_scope} className="shrink-0" />
                    </>
                  )}
                  {r.granted_by_persona && (
                    <span
                      className="shrink-0"
                      title={`Granted by persona ${r.granted_by_persona}`}
                    >
                      <Drama className="w-3 h-3 text-text-tertiary" aria-hidden />
                    </span>
                  )}
                  <button
                    onClick={() => handleRemove(r.role)}
                    className="shrink-0 text-text-tertiary hover:text-status-error transition-colors ml-1"
                    title={`Remove ${r.role}`}
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}

          {available.length > 0 && (
            <div className="pt-3 border-t border-surface-border space-y-2">
              <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
                Add Role
              </p>
              {/* Stacked, label-over-control fields (the app's form pattern) —
                  every control is w-full/min-w-0, so a long role key or scope
                  label can never widen the column or push the button away. */}
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="select text-xs font-mono w-full min-w-0"
                aria-label="Role"
              >
                <option value="">Select a role...</option>
                {available.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <div className="min-w-0">
                  <label className="block text-2xs text-text-tertiary mb-1">Type</label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as LTRoleType)}
                    className="select text-xs w-full min-w-0"
                    aria-label="Role type"
                  >
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                    <option value="superadmin">superadmin</option>
                  </select>
                </div>
                {newType === 'member' && (
                  <div className="min-w-0">
                    <label className="block text-2xs text-text-tertiary mb-1">Scope</label>
                    <select
                      value={newScope}
                      onChange={(e) => setNewScope(e.target.value)}
                      className="select text-xs w-full min-w-0"
                      aria-label="Work-surface scope"
                    >
                      {SCOPE_PRESETS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div className="flex justify-end pt-1">
                <button
                  onClick={handleAdd}
                  disabled={!newRole || addRole.isPending}
                  className="btn-primary text-xs"
                >
                  {addRole.isPending ? '...' : 'Add Role'}
                </button>
              </div>
              {addRole.error && (
                <p className="text-2xs text-status-error">{(addRole.error as Error).message}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
