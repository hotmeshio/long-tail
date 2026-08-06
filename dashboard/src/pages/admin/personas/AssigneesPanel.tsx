import { useState } from 'react';
import { X } from 'lucide-react';
import { usePersona, useAssignPersona, useUnassignPersona } from '../../../api/personas';
import { DateValue } from '../../../components/common/display/DateValue';
import { UserCombobox, type UserComboboxSelection } from '../../../components/common/form/UserCombobox';

const SECTION_HDR = 'text-2xs font-semibold uppercase tracking-widest text-text-tertiary';

/**
 * The 90% surface: pick a persona in the list, assign a user, and they get
 * every linked role — pins, list schemas, and forms compose from the roles.
 * Rendered in the global shell right panel (key 'persona-assignees').
 */
export function AssigneesPanel({
  personaKey,
  onClose,
}: {
  personaKey: string | null;
  onClose?: () => void;
}) {
  const { data: persona } = usePersona(personaKey ?? '');
  const assign = useAssignPersona();
  const unassign = useUnassignPersona();
  const [pendingUser, setPendingUser] = useState<UserComboboxSelection | null>(null);

  const assignees = persona?.assignees ?? [];

  const handleAssign = () => {
    if (!persona || !pendingUser) return;
    assign.mutate(
      { userId: pendingUser.id, key: persona.key },
      { onSuccess: () => setPendingUser(null) },
    );
  };

  return (
    <div className="h-full overflow-y-auto px-5 pt-4 pb-6">
      <div className="flex items-center justify-between mb-4">
        <p className={SECTION_HDR}>Assignees</p>
        {onClose && (
          <button onClick={onClose} className="icon-link" title="Close" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {!persona ? (
        <p className="text-xs text-text-tertiary">
          Select a persona to assign users. An assignee joins every linked role
          at its scope — sidebar pins and forms compose from the roles.
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-sm text-text-primary">{persona.title || persona.key}</p>
            <p className="text-2xs text-text-tertiary mt-0.5">
              {persona.roles.length} role{persona.roles.length === 1 ? '' : 's'} per assignment
            </p>
          </div>

          {assignees.length === 0 ? (
            <p className="text-xs text-text-tertiary">
              Assign a user to compose their whole surface in one step.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {assignees.map((a) => (
                <span
                  key={a.id}
                  className="flex items-center gap-2.5 w-full min-w-0 pl-2.5 pr-2 py-1 text-xs bg-surface-sunken rounded-full text-text-secondary"
                >
                  <span className="flex-1 min-w-0 truncate" title={a.external_id}>
                    {a.display_name || a.external_id}
                  </span>
                  <span className="shrink-0 text-2xs text-text-tertiary">
                    <DateValue date={a.assigned_at} />
                  </span>
                  <button
                    onClick={() => unassign.mutate({ userId: a.id, key: persona.key })}
                    className="shrink-0 text-text-tertiary hover:text-status-error transition-colors ml-1"
                    title={`Unassign ${a.display_name || a.external_id}`}
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-surface-border space-y-2">
            <p className={SECTION_HDR}>Assign User</p>
            <UserCombobox
              selected={pendingUser}
              onSelect={setPendingUser}
              excludeIds={assignees.map((a) => a.id)}
            />
            <div className="flex justify-end pt-1">
              <button
                onClick={handleAssign}
                disabled={!pendingUser || assign.isPending}
                className="btn-primary text-xs"
              >
                {assign.isPending ? '...' : 'Assign'}
              </button>
            </div>
            {(assign.error || unassign.error) && (
              <p className="text-2xs text-status-error">
                {((assign.error || unassign.error) as Error).message}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
