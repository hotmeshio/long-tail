import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreatePersona } from '../../../api/personas';
import { Modal } from '../../../components/common/modal/Modal';

export function CreatePersonaModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const createPersona = useCreatePersona();
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setKey('');
      setTitle('');
      setDescription('');
      createPersona.reset();
    }
  }

  const handleCreate = () => {
    const trimmed = key.trim().toLowerCase();
    if (!trimmed) return;
    createPersona.mutate(
      {
        key: trimmed,
        title: title.trim() || undefined,
        description: description.trim() || undefined,
      },
      {
        onSuccess: () => {
          onClose();
          // Land on the detail page to link roles right away.
          navigate(`/admin/personas/${encodeURIComponent(trimmed)}`);
        },
      },
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Persona">
      <div className="space-y-4">
        <div>
          <label className="block text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Key (required)
          </label>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="e.g., floor-manager"
            className="input text-xs w-full font-mono"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
          />
          <p className="text-2xs text-text-tertiary mt-1">
            Lowercase letters, numbers, hyphens, and underscores only. Stable — it names the persona everywhere.
          </p>
        </div>

        <div>
          <label className="block text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Floor Manager"
            className="input text-xs w-full"
          />
        </div>

        <div>
          <label className="block text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="The day in the life, one paragraph."
            rows={3}
            className="input text-xs w-full resize-y"
          />
        </div>

        {createPersona.error && (
          <p className="text-xs text-status-error">{(createPersona.error as Error).message}</p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary text-xs">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!key.trim() || createPersona.isPending}
            className="btn-primary text-xs"
          >
            {createPersona.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
