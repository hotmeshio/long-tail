import { useState } from 'react';
import { useUpsertWorkflowConfig } from '../../../api/workflows';
import { Modal } from '../../../components/common/Modal';
import { StepIndicator } from '../../../components/common/StepIndicator';
import { splitCsv } from '../../../lib/parse';
import type { LTWorkflowConfig } from '../../../api/types';

// ── Form state ──────────────────────────────────────────────────────────────

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
  lifecycle: string;
  envelope_schema: string;
  resolver_schema: string;
  cron_schedule: string;
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
  lifecycle: '',
  envelope_schema: '',
  resolver_schema: '',
  cron_schedule: '',
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
    lifecycle: c.lifecycle && Object.keys(c.lifecycle).length > 0
      ? JSON.stringify(c.lifecycle, null, 2)
      : '',
    envelope_schema: c.envelope_schema ? JSON.stringify(c.envelope_schema, null, 2) : '',
    resolver_schema: c.resolver_schema ? JSON.stringify(c.resolver_schema, null, 2) : '',
    cron_schedule: c.cron_schedule ?? '',
  };
}

// ── Wizard steps ────────────────────────────────────────────────────────────

const STEP_LABELS = ['Basics', 'Access', 'Schemas', 'Hooks'];

function jsonValid(v: string): boolean {
  if (!v.trim()) return true;
  try { JSON.parse(v); return true; } catch { return false; }
}

function isStepValid(step: number, form: ConfigFormState): boolean {
  if (step === 0) return !!form.workflow_type.trim();
  if (step === 2) return jsonValid(form.envelope_schema) && jsonValid(form.resolver_schema);
  if (step === 3) return jsonValid(form.lifecycle);
  return true;
}

const labelCls = 'block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1';
const hintCls = 'text-[10px] text-text-tertiary mt-2 leading-relaxed';
const jsonCls = 'input font-mono text-[11px] w-full leading-relaxed tabular-nums';

// ── Component ───────────────────────────────────────────────────────────────

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
  const [step, setStep] = useState(0);
  const [schemaError, setSchemaError] = useState('');
  const upsert = useUpsertWorkflowConfig();

  // Reset form when modal opens with new data
  const [prevEditing, setPrevEditing] = useState(editing);
  if (editing !== prevEditing) {
    setPrevEditing(editing);
    setForm(editing ? configToForm(editing) : EMPTY_FORM);
    setStep(0);
    setSchemaError('');
  }

  const set = (field: keyof ConfigFormState, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }));

  // ── Save ────────────────────────────────────────────────────────────────

  const handleSave = () => {
    if (!form.workflow_type.trim()) return;
    setSchemaError('');

    let lifecycle: Record<string, unknown> = { onBefore: [], onAfter: [] };
    let envelope_schema: Record<string, unknown> | null = null;
    let resolver_schema: Record<string, unknown> | null = null;

    try {
      if (form.lifecycle.trim()) lifecycle = JSON.parse(form.lifecycle);
    } catch {
      setSchemaError('Invalid JSON in Lifecycle');
      return;
    }
    try {
      if (form.envelope_schema.trim()) envelope_schema = JSON.parse(form.envelope_schema);
    } catch {
      setSchemaError('Invalid JSON in Envelope Schema');
      return;
    }
    try {
      if (form.resolver_schema.trim()) resolver_schema = JSON.parse(form.resolver_schema);
    } catch {
      setSchemaError('Invalid JSON in Resolver Schema');
      return;
    }

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
        lifecycle,
        envelope_schema,
        resolver_schema,
        cron_schedule: form.cron_schedule.trim() || null,
      },
      { onSuccess: onClose },
    );
  };

  // ── Step 0 — Basics ───────────────────────────────────────────────────

  function renderBasics() {
    return (
      <div className="space-y-5">
        <div>
          <label className={labelCls}>Workflow Type</label>
          <input
            type="text"
            value={form.workflow_type}
            onChange={(e) => set('workflow_type', e.target.value)}
            disabled={!!editing}
            placeholder="reviewContent"
            className="input font-mono text-xs w-full"
          />
          <p className={hintCls}>
            Unique identifier for this workflow. Must match the function name registered with the worker.
          </p>
        </div>

        <div>
          <label className={labelCls}>Description</label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="AI-powered content moderation with human escalation"
            className="input text-xs w-full"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Task Queue</label>
            <input
              type="text"
              value={form.task_queue}
              onChange={(e) => set('task_queue', e.target.value)}
              placeholder="lt-review"
              className="input font-mono text-xs w-full"
            />
            <p className={hintCls}>
              Durable task queue this workflow listens on
            </p>
          </div>
          <div>
            <label className={labelCls}>Default Role</label>
            <input
              type="text"
              value={form.default_role}
              onChange={(e) => set('default_role', e.target.value)}
              placeholder="reviewer"
              className="input text-xs w-full"
            />
            <p className={hintCls}>
              Escalations route to users with this role
            </p>
          </div>
        </div>

        <div>
          <label className={labelCls}>Default Modality</label>
          <input
            type="text"
            value={form.default_modality}
            onChange={(e) => set('default_modality', e.target.value)}
            placeholder="portal"
            className="input text-xs w-full"
          />
          <p className={hintCls}>
            How escalations are delivered: <span className="font-mono">portal</span>, <span className="font-mono">email</span>, or <span className="font-mono">sms</span>
          </p>
        </div>

        <div className="flex gap-6 pt-1">
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
        <p className={hintCls}>
          <span className="font-medium text-text-secondary">Container</span> = orchestrator that spawns child workflows.{' '}
          <span className="font-medium text-text-secondary">Invocable</span> = can be started from the dashboard.
        </p>
      </div>
    );
  }

  // ── Step 1 — Access ───────────────────────────────────────────────────

  function renderAccess() {
    return (
      <div className="space-y-5">
        <p className="text-xs text-text-secondary leading-relaxed">
          Control which roles can interact with this workflow and its escalations.
        </p>

        <div>
          <label className={labelCls}>Roles</label>
          <input
            type="text"
            value={form.roles}
            onChange={(e) => set('roles', e.target.value)}
            placeholder="reviewer, engineer, admin"
            className="input text-xs w-full"
          />
          <p className={hintCls}>
            Comma-separated. Users with any of these roles can claim and resolve escalations from this workflow.
          </p>
        </div>

        <div>
          <label className={labelCls}>Invocation Roles</label>
          <input
            type="text"
            value={form.invocation_roles}
            onChange={(e) => set('invocation_roles', e.target.value)}
            placeholder="engineer, admin"
            className="input text-xs w-full"
          />
          <p className={hintCls}>
            Comma-separated. Only users with these roles can start this workflow from the dashboard.
            Leave empty to allow all authenticated users.
          </p>
        </div>

        <div>
          <label className={labelCls}>Consumes</label>
          <input
            type="text"
            value={form.consumes}
            onChange={(e) => set('consumes', e.target.value)}
            placeholder="reviewContent, verifyDocument"
            className="input text-xs w-full"
          />
          <p className={hintCls}>
            Comma-separated. Other workflow types whose output this workflow depends on.
            Used by orchestrators to declare child workflow dependencies.
          </p>
        </div>
      </div>
    );
  }

  // ── Step 2 — Schemas ──────────────────────────────────────────────────

  function renderSchemas() {
    return (
      <div className="space-y-5">
        <p className="text-xs text-text-secondary leading-relaxed">
          JSON templates that pre-fill editors in the dashboard. Not validated at runtime — these are developer hints.
        </p>

        {form.invocable ? (
          <div>
            <label className={labelCls}>Envelope Schema</label>
            <textarea
              value={form.envelope_schema}
              onChange={(e) => set('envelope_schema', e.target.value)}
              placeholder={`{\n  "data": {\n    "contentId": "example-123",\n    "content": "Text to review"\n  },\n  "metadata": {\n    "source": "dashboard"\n  }\n}`}
              className={jsonCls}
              rows={8}
              spellCheck={false}
            />
            <p className={hintCls}>
              Pre-fills the JSON editor on the <span className="font-medium text-text-secondary">Start Workflow</span> page.
              Should include <span className="font-mono">data</span> (workflow input) and optional <span className="font-mono">metadata</span> (context).
            </p>
            {form.envelope_schema.trim() && !jsonValid(form.envelope_schema) && (
              <p className="text-[10px] text-status-error mt-1">Invalid JSON</p>
            )}
          </div>
        ) : (
          <div className="py-4 text-center">
            <p className="text-xs text-text-tertiary">
              Envelope schema is only available for invocable workflows.
            </p>
            <p className="text-[10px] text-text-tertiary mt-1">
              Enable <span className="font-medium">Invocable</span> on the Basics step to configure this.
            </p>
          </div>
        )}

        <div>
          <label className={labelCls}>Resolver Schema</label>
          <textarea
            value={form.resolver_schema}
            onChange={(e) => set('resolver_schema', e.target.value)}
            placeholder={`{\n  "approved": true,\n  "analysis": {\n    "confidence": 0.95,\n    "flags": [],\n    "summary": "Content meets guidelines"\n  }\n}`}
            className={jsonCls}
            rows={8}
            spellCheck={false}
          />
          <p className={hintCls}>
            Pre-fills the JSON editor when an operator resolves an escalation from this workflow.
            Should match the shape your workflow expects in the resolver callback.
          </p>
          {form.resolver_schema.trim() && !jsonValid(form.resolver_schema) && (
            <p className="text-[10px] text-status-error mt-1">Invalid JSON</p>
          )}
        </div>
      </div>
    );
  }

  // ── Step 3 — Hooks ────────────────────────────────────────────────────

  function renderHooks() {
    return (
      <div className="space-y-5">
        <p className="text-xs text-text-secondary leading-relaxed">
          Lifecycle hooks run before or after workflow execution. Use them for logging, metrics, notifications, or data enrichment.
        </p>

        <div>
          <label className={labelCls}>Lifecycle</label>
          <textarea
            value={form.lifecycle}
            onChange={(e) => set('lifecycle', e.target.value)}
            placeholder={`{\n  "onBefore": [\n    {\n      "type": "log",\n      "config": { "level": "info" }\n    }\n  ],\n  "onAfter": [\n    {\n      "type": "notify",\n      "config": { "channel": "#ops" }\n    }\n  ]\n}`}
            className={jsonCls}
            rows={12}
            spellCheck={false}
          />
          <p className={hintCls}>
            <span className="font-mono">onBefore</span> hooks execute before the workflow starts.{' '}
            <span className="font-mono">onAfter</span> hooks execute after it completes or fails.
            Each hook has a <span className="font-mono">type</span> and optional <span className="font-mono">config</span>.
          </p>
          {form.lifecycle.trim() && !jsonValid(form.lifecycle) && (
            <p className="text-[10px] text-status-error mt-1">Invalid JSON</p>
          )}
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const isLast = step === STEP_LABELS.length - 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit — ${editing.workflow_type}` : 'Add Workflow Config'}
      maxWidth="max-w-3xl"
    >
      <StepIndicator steps={STEP_LABELS} currentStep={step} />

      <div className="min-h-[360px]">
        {step === 0 && renderBasics()}
        {step === 1 && renderAccess()}
        {step === 2 && renderSchemas()}
        {step === 3 && renderHooks()}
      </div>

      {(schemaError || upsert.error) && (
        <p className="text-xs text-status-error mt-4">
          {schemaError || (upsert.error as Error).message}
        </p>
      )}

      {/* Navigation */}
      <div className="flex justify-between items-center pt-4 border-t border-surface-border mt-4">
        <div>
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="btn-secondary text-xs"
            >
              Back
            </button>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="btn-ghost text-xs">
            Cancel
          </button>
          {isLast ? (
            <button
              onClick={handleSave}
              disabled={!isStepValid(step, form) || upsert.isPending}
              className="btn-primary text-xs"
            >
              {upsert.isPending ? 'Saving...' : editing ? 'Save' : 'Create'}
            </button>
          ) : (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!isStepValid(step, form)}
              className="btn-primary text-xs"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
