import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, Trash2 } from 'lucide-react';
import { useDeleteRole } from '../../../../api/roles';
import { AutoGrowTextarea } from '../../../../components/common/form/AutoGrowTextarea';
import { ConfirmDeleteModal } from '../../../../components/common/modal/ConfirmDeleteModal';
import { SectionGroup, type SectionProps } from '../role-detail-shared';

/**
 * Identity — what the role is called and says about itself, and (when nothing
 * references it) the place it can be deleted. Deletion is an identity-level
 * act, so the danger zone lives here rather than in the always-visible footer.
 */
export function IdentitySection({ role, draft, update }: SectionProps) {
  const navigate = useNavigate();
  const deleteRole = useDeleteRole();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const inUse = role.user_count > 0 || role.chain_count > 0 || role.workflow_count > 0;

  return (
    <div className="space-y-14">
      <SectionGroup icon={Tag} label="Identity" annotation="name and description" accent>
        <div className="space-y-8">
          <div>
            <label className="block text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">
              Display Name
            </label>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder={`e.g., ${role.role.charAt(0).toUpperCase() + role.role.slice(1)}`}
              className="input text-sm w-full"
            />
          </div>

          <div>
            <label className="block text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">
              Description
            </label>
            <AutoGrowTextarea
              value={draft.description}
              onChange={(v) => update({ description: v })}
              placeholder="A short description shown on role cards and in the operations view."
              rows={2}
            />
          </div>
        </div>
      </SectionGroup>

      {/* Danger zone — only when nothing references the role */}
      <div className="border-t border-surface-border/40 pt-6">
        {inUse ? (
          <p className="text-2xs text-text-quaternary leading-relaxed">
            This role is referenced by{' '}
            {[
              role.user_count > 0 ? `${role.user_count} member${role.user_count === 1 ? '' : 's'}` : null,
              role.workflow_count > 0 ? `${role.workflow_count} workflow${role.workflow_count === 1 ? '' : 's'}` : null,
              role.chain_count > 0 ? 'routing config' : null,
            ].filter(Boolean).join(', ')}{' '}
            and cannot be deleted.
          </p>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="px-3 py-1.5 text-xs rounded-md text-status-error/60 hover:text-status-error hover:bg-status-error/10 transition-colors flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" /> Delete this role
          </button>
        )}
      </div>

      <ConfirmDeleteModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteRole.mutate(role.role, { onSuccess: () => navigate('/admin/roles') })}
        title="Delete Role"
        description={
          <>
            Delete role <span className="font-medium font-mono text-text-primary">{role.role}</span>? This cannot be undone.
          </>
        }
        isPending={deleteRole.isPending}
        error={deleteRole.error as Error | null}
      />
    </div>
  );
}
