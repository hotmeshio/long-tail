import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Code2, Play, ShieldOff,
} from 'lucide-react';
import { useWorkflowConfigs, useUpsertWorkflowConfig, useDeleteWorkflowConfig, useJobs } from '../../../api/workflows';
import { ConfirmDeleteModal } from '../../../components/common/modal/ConfirmDeleteModal';
import { RolePicker } from '../../../components/common/form/RolePicker';
import { BotPicker } from '../../../components/common/form/BotPicker';
import { NamespacePill } from '../../../components/common/display/NamespacePill';
import { splitCsv } from '../../../lib/parse';
import { EMPTY_FORM, configToForm, jsonValid } from './config-form-types';
import type { ConfigFormState } from './config-form-types';

// ── Local helpers ─────────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, color, children }: { icon: React.ElementType; color: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4 pb-2 border-b border-surface-border">
      <Icon className={`w-4 h-4 ${color}`} strokeWidth={1.5} />
      <h2 className="section-h2">{children}</h2>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="label">{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

const jsonCls = 'input-json w-full';

function csvToArray(csv: string): string[] { return splitCsv(csv); }
function arrayToCsv(arr: string[]): string { return arr.join(', '); }

const SYSTEM_WORKFLOWS = new Set([
  'mcpQuery', 'mcpDeterministic', 'mcpQueryRouter', 'mcpTriage',
  'mcpTriageRouter', 'mcpTriageDeterministic', 'insightQuery',
]);

// ── Page ─────────────────────────────────────────────────────────────────────

export function WorkflowConfigDetailPage() {
  const { workflowType } = useParams<{ workflowType: string }>();
  const isNew = !workflowType;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: configs, isLoading } = useWorkflowConfigs();
  const upsert = useUpsertWorkflowConfig();
  const deleteConfig = useDeleteWorkflowConfig();
  const [confirmUnregister, setConfirmUnregister] = useState(false);

  const editing = configs?.find((c) => c.workflow_type === workflowType) ?? null;

  const { data: jobsData } = useJobs({ limit: 500 });
  const unregisteredTypes = useMemo(() => {
    const registeredSet = new Set((configs ?? []).map((c) => c.workflow_type));
    const allEntities = new Set((jobsData?.jobs ?? []).map((j: any) => j.entity));
    return [...allEntities]
      .filter((e: string) => !registeredSet.has(e) && !SYSTEM_WORKFLOWS.has(e))
      .sort();
  }, [configs, jobsData]);

  const prefillForm = useMemo((): ConfigFormState => {
    if (!isNew) return EMPTY_FORM;
    const prefillType = searchParams.get('workflow_type') ?? '';
    const prefillQueue = searchParams.get('task_queue') ?? '';
    return prefillType || prefillQueue
      ? { ...EMPTY_FORM, workflow_type: prefillType, task_queue: prefillQueue }
      : EMPTY_FORM;
  }, [isNew, searchParams]);

  const [form, setForm] = useState<ConfigFormState>(prefillForm);
  const [schemaError, setSchemaError] = useState('');
  const [initialized, setInitialized] = useState(false);

  const set = useCallback(
    (field: keyof ConfigFormState, value: string | boolean) =>
      setForm((f) => ({ ...f, [field]: value })),
    [],
  );

  useEffect(() => {
    if (initialized) return;
    if (isNew) { setForm(prefillForm); setInitialized(true); return; }
    if (editing) { setForm(configToForm(editing)); setInitialized(true); }
  }, [editing, isNew, initialized, prefillForm]);

  const handleSave = () => {
    if (!form.workflow_type.trim()) return;
    setSchemaError('');

    let envelope_schema: Record<string, unknown> | null = null;
    let resolver_schema: Record<string, unknown> | null = null;
    try {
      if (form.envelope_schema.trim()) envelope_schema = JSON.parse(form.envelope_schema);
    } catch { setSchemaError('Invalid JSON in Envelope Schema'); return; }
    try {
      if (form.resolver_schema.trim()) resolver_schema = JSON.parse(form.resolver_schema);
    } catch { setSchemaError('Invalid JSON in Resolver Schema'); return; }

    upsert.mutate(
      {
        workflow_type: form.workflow_type.trim(),
        description: form.description.trim() || null,
        task_queue: form.task_queue.trim() || null,
        default_role: form.default_role.trim() || 'reviewer',
        invocable: form.invocable,
        certified: form.certified,
        roles: splitCsv(form.roles),
        invocation_roles: splitCsv(form.invocation_roles),
        consumes: splitCsv(form.consumes),
        envelope_schema,
        resolver_schema,
        cron_schedule: form.cron_schedule.trim() || null,
        execute_as: form.execute_as.trim() || null,
      },
      { onSuccess: () => navigate('/workflows/registry') },
    );
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-64" />
        <div className="h-40 bg-surface-sunken rounded" />
      </div>
    );
  }
  if (!isNew && !editing) {
    return <p className="text-sm text-text-secondary">Config not found.</p>;
  }

  const canSave = !!form.workflow_type.trim() && jsonValid(form.envelope_schema) && jsonValid(form.resolver_schema);
  const showPickList = isNew && !form.workflow_type && unregisteredTypes.length > 0;

  return (
    <div>
      {/* Hero */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-light font-mono text-text-primary">
            {isNew ? 'New Workflow' : editing?.workflow_type ?? ''}
          </h1>
          {editing && (
            <div className="flex items-center gap-2 mt-2">
              <NamespacePill namespace="durable" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1">
          <button onClick={() => navigate('/workflows/registry')} className="btn-ghost text-xs">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || upsert.isPending}
            className="btn-primary text-xs"
          >
            {upsert.isPending ? 'Saving…' : isNew ? 'Register' : 'Save'}
          </button>
        </div>
      </div>

      {/* Three-column form */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-14 gap-y-10">

        {/* ── Identity ─────────────────────────────────────────────────── */}
        <div>
          <SectionHeader icon={Code2} color="text-accent">Identity</SectionHeader>
          <div className="space-y-5">
            <Field
              label="Workflow Type"
              hint="Register a workflow to configure invocation and HITL escalation routing."
            >
              {showPickList ? (
                <div className="space-y-2">
                  <p className="text-xs text-text-secondary">Select a durable workflow to register:</p>
                  <div className="grid gap-1">
                    {(unregisteredTypes as string[]).map((type) => (
                      <button
                        key={type}
                        onClick={() => set('workflow_type', type)}
                        className="flex items-center gap-2 px-3 py-2 text-left text-xs font-mono rounded-md border border-surface-border hover:border-accent/50 hover:bg-accent/[0.04] transition-colors"
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-2xs text-text-tertiary">or</span>
                    <input
                      type="text"
                      onChange={(e) => set('workflow_type', e.target.value)}
                      placeholder="Enter type manually"
                      className="input font-mono flex-1"
                    />
                  </div>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={form.workflow_type}
                    onChange={(e) => set('workflow_type', e.target.value)}
                    disabled={!isNew}
                    placeholder="reviewContent"
                    className="input font-mono w-full"
                  />
                  {isNew && form.workflow_type && unregisteredTypes.length > 0 && (
                    <button
                      onClick={() => set('workflow_type', '')}
                      className="text-2xs text-accent hover:underline mt-1"
                    >
                      Choose from durable workflows
                    </button>
                  )}
                </>
              )}
            </Field>

            <Field label="Description">
              <input
                type="text"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Describe what this workflow does"
                className="input text-xs w-full"
              />
            </Field>

            <Field label="Task Queue" hint="Durable task queue this workflow listens on.">
              <input
                type="text"
                value={form.task_queue}
                onChange={(e) => set('task_queue', e.target.value)}
                placeholder="lt-review"
                className="input font-mono w-full"
              />
            </Field>
          </div>
        </div>

        {/* ── Invocation ───────────────────────────────────────────────── */}
        <div>
          <SectionHeader icon={Play} color="text-accent">Invocation</SectionHeader>
          <div className="space-y-5">
            <div className="space-y-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.invocable}
                  onChange={(e) => set('invocable', e.target.checked)}
                  className="w-4 h-4 rounded border-border accent-accent"
                />
                <span className="text-xs text-text-primary font-medium">Invocable</span>
              </label>
              <p className="hint">Allow this workflow to be started from the dashboard or API.</p>
            </div>

            {form.invocable ? (
              <>
                <Field label="Run As" hint="Bot identity to run under. Default runs as the invoking user.">
                  <BotPicker selected={form.execute_as} onChange={(id) => set('execute_as', id)} />
                </Field>

                <Field label="Invocation Roles" hint="Only users with these roles can start this workflow. Empty = all authenticated users.">
                  <RolePicker
                    selected={csvToArray(form.invocation_roles)}
                    onChange={(roles) => set('invocation_roles', arrayToCsv(roles))}
                    placeholder="Select roles…"
                  />
                </Field>

                <Field label="Envelope Schema" hint={<>Pre-fills the JSON editor when invoking. Include <code className="font-mono">data</code> (input) and optional <code className="font-mono">metadata</code>.</>}>
                  <textarea
                    value={form.envelope_schema}
                    onChange={(e) => set('envelope_schema', e.target.value)}
                    placeholder={'{\n  "data": {},\n  "metadata": {}\n}'}
                    className={jsonCls}
                    rows={8}
                    spellCheck={false}
                  />
                  {form.envelope_schema.trim() && !jsonValid(form.envelope_schema) && (
                    <p className="text-2xs text-status-error mt-1">Invalid JSON</p>
                  )}
                </Field>
              </>
            ) : (
              <p className="text-2xs text-text-tertiary py-2">
                Enable <span className="font-medium text-text-secondary">Invocable</span> to configure invocation roles and an input template.
              </p>
            )}
          </div>
        </div>

        {/* Escalation & resolution config is ROLE-owned now — a workflow no longer
            declares a resolver schema or a certification tier here. The escalation
            surface (form_schema + resolver_schema, versioned) lives on the target
            role. This section is intentionally hidden from the workflow view. */}
        {editing && (
          <div>
            <SectionHeader icon={ShieldOff} color="text-text-tertiary">Registration</SectionHeader>
            <button
              onClick={() => setConfirmUnregister(true)}
              className="flex items-center gap-1.5 text-2xs text-status-warning hover:underline"
              title="Delete this registration — the workflow returns to plain durable"
            >
              <ShieldOff className="w-3 h-3" /> Unregister workflow
            </button>
          </div>
        )}
      </div>

      {(schemaError || upsert.error) && (
        <p className="text-xs text-status-error mt-8">
          {schemaError || (upsert.error as Error).message}
        </p>
      )}

      <ConfirmDeleteModal
        open={confirmUnregister}
        onClose={() => setConfirmUnregister(false)}
        onConfirm={() =>
          deleteConfig.mutate(editing!.workflow_type, {
            onSuccess: () => navigate('/workflows/registry'),
          })
        }
        title="Unregister Workflow"
        description={
          <>
            Delete the registration for{' '}
            <span className="font-mono font-medium text-text-primary">{editing?.workflow_type}</span>?
            This removes its invocation settings, certification, and interceptor treatment; the
            workflow keeps running as a plain durable workflow. Escalation schemas versioned on
            roles are untouched.
          </>
        }
        isPending={deleteConfig.isPending}
        error={deleteConfig.error as Error | null}
      />
    </div>
  );
}
