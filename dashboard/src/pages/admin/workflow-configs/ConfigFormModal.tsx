import { useState } from 'react';
import { useUpsertWorkflowConfig } from '../../../api/workflows';
import { Modal } from '../../../components/common/Modal';
import { JsonViewer } from '../../../components/common/JsonViewer';
import { splitCsv } from '../../../lib/parse';
import type { LTWorkflowConfig } from '../../../api/types';

// ── Config Form ─────────────────────────────────────────────────────────────

interface ConfigFormState {
  workflow_type: string;
  description: string;
  task_queue: string;
  default_role: string;
  default_modality: string;
  is_lt: boolean;
  is_container: boolean;
  invocable: boolean;
  roles: string;
  invocation_roles: string;
  consumes: string;
}

const EMPTY_FORM: ConfigFormState = {
  workflow_type: '',
  description: '',
  task_queue: '',
  default_role: 'reviewer',
  default_modality: 'portal',
  is_lt: true,
  is_container: false,
  invocable: false,
  roles: '',
  invocation_roles: '',
  consumes: '',
};

function configToForm(c: LTWorkflowConfig): ConfigFormState {
  return {
    workflow_type: c.workflow_type,
    description: c.description ?? '',
    task_queue: c.task_queue ?? '',
    default_role: c.default_role,
    default_modality: c.default_modality,
    is_lt: c.is_lt,
    is_container: c.is_container,
    invocable: c.invocable,
    roles: (c.roles ?? []).join(', '),
    invocation_roles: (c.invocation_roles ?? []).join(', '),
    consumes: (c.consumes ?? []).join(', '),
  };
}

export function ConfigFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: LTWorkflowConfig | null;
}) {
  const [form, setForm] = useState<ConfigFormState>(
    editing ? configToForm(editing) : EMPTY_FORM,
  );
  const upsert = useUpsertWorkflowConfig();

  // Reset form when modal opens with new data
  const [prevEditing, setPrevEditing] = useState(editing);
  if (editing !== prevEditing) {
    setPrevEditing(editing);
    setForm(editing ? configToForm(editing) : EMPTY_FORM);
  }

  const handleSave = () => {
    if (!form.workflow_type.trim()) return;
    upsert.mutate(
      {
        workflow_type: form.workflow_type.trim(),
        description: form.description.trim() || null,
        task_queue: form.task_queue.trim() || null,
        default_role: form.default_role.trim() || 'reviewer',
        default_modality: form.default_modality.trim() || 'portal',
        is_lt: form.is_lt,
        is_container: form.is_container,
        invocable: form.invocable,
        roles: splitCsv(form.roles),
        invocation_roles: splitCsv(form.invocation_roles),
        consumes: splitCsv(form.consumes),
      },
      { onSuccess: onClose },
    );
  };

  const set = (field: keyof ConfigFormState, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit — ${editing.workflow_type}` : 'Add Workflow Config'}
    >
      <div className="space-y-4">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Workflow Type
          </label>
          <input
            type="text"
            value={form.workflow_type}
            onChange={(e) => set('workflow_type', e.target.value)}
            disabled={!!editing}
            placeholder="e.g., reviewContent"
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

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
              Task Queue
            </label>
            <input
              type="text"
              value={form.task_queue}
              onChange={(e) => set('task_queue', e.target.value)}
              placeholder="e.g., v1"
              className="input text-xs w-full"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
              Default Role
            </label>
            <input
              type="text"
              value={form.default_role}
              onChange={(e) => set('default_role', e.target.value)}
              className="input text-xs w-full"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Default Modality
          </label>
          <input
            type="text"
            value={form.default_modality}
            onChange={(e) => set('default_modality', e.target.value)}
            className="input text-xs w-full"
          />
        </div>

        <div className="flex gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_lt}
              onChange={(e) => set('is_lt', e.target.checked)}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-xs text-text-primary">LT Workflow</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_container}
              onChange={(e) => set('is_container', e.target.checked)}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-xs text-text-primary">Container</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.invocable}
              onChange={(e) => set('invocable', e.target.checked)}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-xs text-text-primary">Invocable</span>
          </label>
        </div>

        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Roles (comma-separated)
          </label>
          <input
            type="text"
            value={form.roles}
            onChange={(e) => set('roles', e.target.value)}
            placeholder="reviewer, engineer, admin"
            className="input text-xs w-full"
          />
        </div>

        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Invocation Roles (comma-separated)
          </label>
          <input
            type="text"
            value={form.invocation_roles}
            onChange={(e) => set('invocation_roles', e.target.value)}
            placeholder="engineer, admin"
            className="input text-xs w-full"
          />
        </div>

        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Consumes (comma-separated)
          </label>
          <input
            type="text"
            value={form.consumes}
            onChange={(e) => set('consumes', e.target.value)}
            placeholder=""
            className="input text-xs w-full"
          />
        </div>

        {editing?.lifecycle && Object.keys(editing.lifecycle).length > 0 && (
          <div>
            <JsonViewer data={editing.lifecycle} label="Lifecycle (read-only)" />
          </div>
        )}

        {upsert.error && (
          <p className="text-xs text-status-error">{(upsert.error as Error).message}</p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary text-xs">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!form.workflow_type.trim() || upsert.isPending}
            className="btn-primary text-xs"
          >
            {upsert.isPending ? 'Saving...' : editing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
