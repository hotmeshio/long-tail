import { useState } from 'react';
import { useUpdateBot } from '../../../api/bots';
import { Modal } from '../../../components/common/modal/Modal';
import type { BotRecord } from '../../../api/types';

export function EditBotModal({
  open,
  onClose,
  bot,
}: {
  open: boolean;
  onClose: () => void;
  bot: BotRecord | null;
}) {
  const updateBot = useUpdateBot();
  const [form, setForm] = useState({
    display_name: '',
    description: '',
    status: 'active' as string,
  });

  const [prevBot, setPrevBot] = useState(bot);
  if (bot !== prevBot) {
    setPrevBot(bot);
    if (bot) {
      setForm({
        display_name: bot.display_name ?? '',
        description: bot.description ?? '',
        status: bot.status,
      });
    }
  }

  const handleSave = () => {
    if (!bot) return;
    updateBot.mutate(
      {
        id: bot.id,
        display_name: form.display_name.trim() || undefined,
        description: form.description.trim() || undefined,
        status: form.status,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit — ${bot?.display_name || bot?.external_id || ''}`}
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
            Description
          </label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
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

        {updateBot.error && (
          <p className="text-xs text-status-error">{(updateBot.error as Error).message}</p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary text-xs">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={updateBot.isPending}
            className="btn-primary text-xs"
          >
            {updateBot.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
