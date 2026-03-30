import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkflowConfigs, useUpsertWorkflowConfig, useInvokeWorkflow } from '../../../api/workflows';
import { useToast } from '../../../hooks/useToast';
import { StepIndicator } from '../../../components/common/layout/StepIndicator';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { splitCsv } from '../../../lib/parse';
import { EMPTY_FORM, configToForm, STEP_LABELS, isStepValid, DEFAULT_ENVELOPE } from './config-form-types';
import type { ConfigFormState } from './config-form-types';
import { BasicsStep, AccessStep, SchemasStep } from './ConfigWizardSteps';
import { InvokeSidebar } from './InvokeSidebar';

export function WorkflowConfigDetailPage() {
  const { workflowType } = useParams<{ workflowType: string }>();
  const isNew = !workflowType;
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { data: configs, isLoading } = useWorkflowConfigs();
  const upsert = useUpsertWorkflowConfig();

  const editing = configs?.find((c) => c.workflow_type === workflowType) ?? null;

  const [form, setForm] = useState<ConfigFormState>(EMPTY_FORM);
  const [schemaError, setSchemaError] = useState('');
  const [initialized, setInitialized] = useState(false);

  // Step via URL search param for browser history
  const [searchParams, setSearchParams] = useSearchParams();
  const step = parseInt(searchParams.get('step') || '0', 10);
  const setStep = useCallback((s: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('step', String(s));
      return next;
    }, { replace: false });
  }, [setSearchParams]);

  const invokeMutation = useInvokeWorkflow();
  const [invokeJson, setInvokeJson] = useState(DEFAULT_ENVELOPE);
  const [invokeParseError, setInvokeParseError] = useState('');

  useEffect(() => {
    if (initialized) return;
    if (isNew) { setInitialized(true); return; }
    if (editing) {
      setForm(configToForm(editing));
      setInitialized(true);
    }
  }, [editing, isNew, initialized]);

  useEffect(() => {
    if (!editing) return;
    setInvokeJson(
      editing.envelope_schema
        ? JSON.stringify(editing.envelope_schema, null, 2)
        : DEFAULT_ENVELOPE,
    );
  }, [editing]);

  const set = (field: keyof ConfigFormState, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }));

  // ── Save ────────────────────────────────────────────────────────────────

  const handleSave = () => {
    if (!form.workflow_type.trim()) return;
    setSchemaError('');

    let envelope_schema: Record<string, unknown> | null = null;
    let resolver_schema: Record<string, unknown> | null = null;

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
        invocable: form.invocable,
        roles: splitCsv(form.roles),
        invocation_roles: splitCsv(form.invocation_roles),
        consumes: splitCsv(form.consumes),
        envelope_schema,
        resolver_schema,
        cron_schedule: form.cron_schedule.trim() || null,
      },
      {
        onSuccess: () => {
          addToast(isNew ? 'Config created' : 'Config saved', 'success');
          navigate('/workflows/registry');
        },
      },
    );
  };

  // ── Loading / Not found ──────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-60 bg-surface-sunken rounded" />
      </div>
    );
  }

  if (!isNew && !editing) {
    return <p className="text-sm text-text-secondary">Config not found.</p>;
  }

  // ── Invoke sidebar ──────────────────────────────────────────────────────

  const handleInvoke = async () => {
    const wfType = form.workflow_type.trim();
    if (!wfType) return;

    setInvokeParseError('');
    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(invokeJson);
    } catch {
      setInvokeParseError('Invalid JSON');
      return;
    }

    const { data, metadata } = envelope;
    if (!data || typeof data !== 'object') {
      setInvokeParseError('Envelope must include a "data" object');
      return;
    }

    try {
      await invokeMutation.mutateAsync({
        workflowType: wfType,
        data: data as Record<string, unknown>,
        metadata: (metadata as Record<string, unknown>) ?? undefined,
      });
      navigate('/workflows/executions');
    } catch {
      // Error available via invokeMutation.error
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  const isLast = step === STEP_LABELS.length - 1;
  const showInvokeSidebar = !isNew && form.invocable;

  return (
    <div>
      <PageHeader title={isNew ? 'Register Workflow' : editing?.workflow_type ?? ''} />

      <div className={`grid gap-12 ${showInvokeSidebar ? 'grid-cols-1 lg:grid-cols-3' : ''}`}>
        {/* Wizard (left / full width) */}
        <div className={showInvokeSidebar ? 'lg:col-span-2' : 'max-w-3xl'}>
          <StepIndicator steps={STEP_LABELS} currentStep={step} onStepClick={setStep} />

          <div className="min-h-[360px] py-2">
            {step === 0 && <BasicsStep form={form} set={set} editing={!!editing} />}
            {step === 1 && <AccessStep form={form} set={set} />}
            {step === 2 && <SchemasStep form={form} set={set} />}
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
              <button onClick={() => navigate('/workflows/registry')} className="btn-ghost text-xs">
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
        </div>

        {/* Invoke sidebar (right) */}
        {showInvokeSidebar && editing && (
          <InvokeSidebar
            invokeJson={invokeJson}
            setInvokeJson={setInvokeJson}
            invokeParseError={invokeParseError}
            setInvokeParseError={setInvokeParseError}
            invokeMutation={invokeMutation}
            onInvoke={handleInvoke}
            editing={editing}
          />
        )}
      </div>
    </div>
  );
}
