import { useState } from 'react';
import { useUpdateUser } from '../../../api/users';
import { Modal } from '../../../components/common/Modal';
import type { LTUserRecord } from '../../../api/types';

export function EditUserModal({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user: LTUserRecord | null;
}) {
  const updateUser = useUpdateUser();
  const [form, setForm] = useState({
    display_name: '',
    email: '',
    status: 'active' as string,
  });

  const [prevUser, setPrevUser] = useState(user);
  if (user !== prevUser) {
    setPrevUser(user);
    if (user) {
      setForm({
        display_name: user.display_name ?? '',
        email: user.email ?? '',
        status: user.status,
      });
    }
  }

  const handleSave = () => {
    if (!user) return;
    updateUser.mutate(
      {
        id: user.id,
        display_name: form.display_name.trim() || undefined,
        email: form.email.trim() || undefined,
        status: form.status,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit — ${user?.display_name || user?.external_id || ''}`}
    >
      <div className="space-y-4">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Display Name
          </label>
          <input
            type="text"
            value={form.display_name}
            onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
            className="input text-xs w-full"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Email
          </label>
          <input
            type="text"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="input text-xs w-full"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Status
          </label>
          <select
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            className="select text-xs w-full"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>

        {updateUser.error && (
          <p className="text-xs text-status-error">{(updateUser.error as Error).message}</p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary text-xs">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={updateUser.isPending}
            className="btn-primary text-xs"
          >
            {updateUser.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
