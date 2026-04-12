import { useState } from 'react';
import { useCreateRole } from '../../../api/roles';
import { Modal } from '../../../components/common/modal/Modal';

export function CreateRoleModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const createRole = useCreateRole();
  const [roleName, setRoleName] = useState('');

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setRoleName('');
      createRole.reset();
    }
  }

  const handleCreate = () => {
    const trimmed = roleName.trim().toLowerCase();
    if (!trimmed) return;
    createRole.mutate(trimmed, { onSuccess: onClose });
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Role">
      <div className="space-y-4">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Role Name (required)
          </label>
          <input
            type="text"
            value={roleName}
            onChange={(e) => setRoleName(e.target.value)}
            placeholder="e.g., reviewer"
            className="input text-xs w-full"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
          />
          <p className="text-[10px] text-text-tertiary mt-1">
            Lowercase letters, numbers, hyphens, and underscores only.
          </p>
        </div>

        {createRole.error && (
          <p className="text-xs text-status-error">{(createRole.error as Error).message}</p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary text-xs">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!roleName.trim() || createRole.isPending}
            className="btn-primary text-xs"
          >
            {createRole.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
