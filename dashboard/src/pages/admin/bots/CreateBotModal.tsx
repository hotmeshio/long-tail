import { useState } from 'react';
import { useCreateBot } from '../../../api/bots';
import { Modal } from '../../../components/common/modal/Modal';

export function CreateBotModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const createBot = useCreateBot();
  const [form, setForm] = useState({
    name: '',
    display_name: '',
    description: '',
  });

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setForm({ name: '', display_name: '', description: '' });
  }

  const handleCreate = () => {
    if (!form.name.trim()) return;
    createBot.mutate(
      {
        name: form.name.trim(),
        display_name: form.display_name.trim() || undefined,
        description: form.description.trim() || undefined,
      },
      { onSuccess: onClose },
    );
  };

  const set = (field: string, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  return (
    <Modal open={open} onClose={onClose} title="Create Bot">
      <div className="space-y-4">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Name (required)
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => set('name', e.target.value.replace(/\s+/g, '-').toLowerCase())}
            placeholder="e.g., ci-bot"
            className="input text-xs w-full font-mono"
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
            placeholder="CI Bot"
            className="input text-xs w-full"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Description
          </label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Runs scheduled workflows"
            className="input text-xs w-full"
          />
        </div>

        {createBot.error && (
          <p className="text-xs text-status-error">{(createBot.error as Error).message}</p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary text-xs">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!form.name.trim() || createBot.isPending}
            className="btn-primary text-xs"
          >
            {createBot.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
