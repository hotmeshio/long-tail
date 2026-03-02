import { useState } from 'react';
import { useCreateMcpServer, useUpdateMcpServer } from '../../../api/mcp';
import { Modal } from '../../../components/common/Modal';
import type { McpServerRecord } from '../../../api/types';

// ── Server Form Modal ─────────────────────────────────────────────────────────

interface ServerFormState {
  name: string;
  description: string;
  transport_type: string;
  transport_config: string;
  auto_connect: boolean;
}

const EMPTY_FORM: ServerFormState = {
  name: '',
  description: '',
  transport_type: 'stdio',
  transport_config: '{}',
  auto_connect: false,
};

function serverToForm(s: McpServerRecord): ServerFormState {
  return {
    name: s.name,
    description: s.description ?? '',
    transport_type: s.transport_type,
    transport_config: JSON.stringify(s.transport_config, null, 2),
    auto_connect: s.auto_connect,
  };
}

export function ServerFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: McpServerRecord | null;
}) {
  const createServer = useCreateMcpServer();
  const updateServer = useUpdateMcpServer();
  const [form, setForm] = useState<ServerFormState>(
    editing ? serverToForm(editing) : EMPTY_FORM,
  );
  const [jsonError, setJsonError] = useState('');

  const [prevEditing, setPrevEditing] = useState(editing);
  if (editing !== prevEditing) {
    setPrevEditing(editing);
    setForm(editing ? serverToForm(editing) : EMPTY_FORM);
    setJsonError('');
  }

  const handleSave = () => {
    setJsonError('');
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(form.transport_config);
    } catch {
      setJsonError('Invalid JSON in transport config');
      return;
    }

    if (editing) {
      updateServer.mutate(
        {
          id: editing.id,
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          transport_type: form.transport_type,
          transport_config: config,
          auto_connect: form.auto_connect,
        },
        { onSuccess: onClose },
      );
    } else {
      if (!form.name.trim()) return;
      createServer.mutate(
        {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          transport_type: form.transport_type,
          transport_config: config,
          auto_connect: form.auto_connect,
        },
        { onSuccess: onClose },
      );
    }
  };

  const isPending = createServer.isPending || updateServer.isPending;
  const error = createServer.error || updateServer.error;

  const set = (field: keyof ServerFormState, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit — ${editing.name}` : 'Register MCP Server'}
    >
      <div className="space-y-4">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Name
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g., vision-server"
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
            placeholder="Optional description"
            className="input text-xs w-full"
          />
        </div>

        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Transport Type
          </label>
          <select
            value={form.transport_type}
            onChange={(e) => set('transport_type', e.target.value)}
            className="select text-xs w-full"
          >
            <option value="stdio">stdio</option>
            <option value="sse">sse</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Transport Config (JSON)
          </label>
          <textarea
            value={form.transport_config}
            onChange={(e) => set('transport_config', e.target.value)}
            className="input font-mono text-xs w-full"
            rows={6}
            spellCheck={false}
          />
          {jsonError && <p className="text-xs text-status-error mt-1">{jsonError}</p>}
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.auto_connect}
            onChange={(e) => set('auto_connect', e.target.checked)}
            className="w-4 h-4 rounded border-border accent-accent"
          />
          <span className="text-xs text-text-primary">Auto-connect on startup</span>
        </label>

        {error && (
          <p className="text-xs text-status-error">{(error as Error).message}</p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary text-xs">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!form.name.trim() || isPending}
            className="btn-primary text-xs"
          >
            {isPending ? 'Saving...' : editing ? 'Save' : 'Register'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
