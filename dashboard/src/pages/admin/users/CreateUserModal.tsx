import { useState } from 'react';
import { useCreateUser } from '../../../api/users';
import { Modal } from '../../../components/common/modal/Modal';

export function CreateUserModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const createUser = useCreateUser();
  const [form, setForm] = useState({
    external_id: '',
    email: '',
    display_name: '',
    password: '',
  });

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setForm({ external_id: '', email: '', display_name: '', password: '' });
  }

  const handleCreate = () => {
    if (!form.external_id.trim()) return;
    createUser.mutate(
      {
        external_id: form.external_id.trim(),
        email: form.email.trim() || undefined,
        display_name: form.display_name.trim() || undefined,
        password: form.password || undefined,
      },
      { onSuccess: onClose },
    );
  };

  const set = (field: string, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  return (
    <Modal open={open} onClose={onClose} title="Create User">
      <div className="space-y-4">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            External ID (required)
          </label>
          <input
            type="text"
            value={form.external_id}
            onChange={(e) => set('external_id', e.target.value)}
            placeholder="e.g., john.doe"
            className="input text-xs w-full"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Display Name
          </label>
          <input
            type="text"
            value={form.display_name}
            onChange={(e) => set('display_name', e.target.value)}
            placeholder="John Doe"
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
            onChange={(e) => set('email', e.target.value)}
            placeholder="john@example.com"
            className="input text-xs w-full"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Password
          </label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            placeholder="Leave blank for no password"
            className="input text-xs w-full"
          />
        </div>

        {createUser.error && (
          <p className="text-xs text-status-error">{(createUser.error as Error).message}</p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary text-xs">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!form.external_id.trim() || createUser.isPending}
            className="btn-primary text-xs"
          >
            {createUser.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
