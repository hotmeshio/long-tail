import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkflowConfigs, useUpsertWorkflowConfig, useInvokeWorkflow, useJobs } from '../../../api/workflows';
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

  // Fetch known workflow types from jobs to build the pick-list.
  // System workflows (triage, query, routing pipelines) are excluded —
  // they serve the discovery/compilation layer, not user-authored flows.
  const SYSTEM_WORKFLOWS = new Set([
    'mcpQuery',
    'mcpDeterministic',
    'mcpQueryRouter',
    'mcpTriage',
    'mcpTriageRouter',
    'mcpTriageDeterministic',
    'insightQuery',
  ]);
  const { data: jobsData } = useJobs({ limit: 500 });
  const unregisteredTypes = useMemo(() => {
    const registeredSet = new Set((configs ?? []).map((c) => c.workflow_type));
    const allEntities = new Set((jobsData?.jobs ?? []).map((j) => j.entity));
    return [...allEntities]
      .filter((e) => !registeredSet.has(e) && !SYSTEM_WORKFLOWS.has(e))
      .sort();
  }, [configs, jobsData]);

  // Step via URL search param for browser history
  const [searchParams, setSearchParams] = useSearchParams();

  // Pre-fill from URL search params when creating new
  const prefillForm = useMemo((): ConfigFormState => {
    if (!isNew) return EMPTY_FORM;
    const prefillType = searchParams.get('workflow_type') ?? '';
    const prefillQueue = searchParams.get('task_queue') ?? '';
    if (!prefillType && !prefillQueue) return EMPTY_FORM;
    return { ...EMPTY_FORM, workflow_type: prefillType, task_queue: prefillQueue };
  }, [isNew, searchParams]);

  const [form, setForm] = useState<ConfigFormState>(prefillForm);
  const [schemaError, setSchemaError] = useState('');
  const [initialized, setInitialized] = useState(false);
  const step = parseInt(searchParams.get('step') || '1', 10);
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
    if (isNew) {
      setForm(prefillForm);
      setInitialized(true);
      return;
    }
    if (editing) {
      setForm(configToForm(editing));
      setInitialized(true);
    }
  }, [editing, isNew, initialized, prefillForm]);

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
        invocable: form.invocable,
        roles: splitCsv(form.roles),
        invocation_roles: splitCsv(form.invocation_roles),
        consumes: splitCsv(form.consumes),
        envelope_schema,
        resolver_schema,
        cron_schedule: form.cron_schedule.trim() || null,
        execute_as: form.execute_as.trim() || null,
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

  const isLast = step === STEP_LABELS.length;
  const showInvokeSidebar = !isNew && form.invocable;

  return (
    <div>
      <PageHeader title={isNew ? 'Register Workflow' : editing?.workflow_type ?? ''} />

      <div className={`grid gap-12 ${showInvokeSidebar ? 'grid-cols-1 lg:grid-cols-3' : ''}`}>
        {/* Wizard (left / full width) */}
        <div className={showInvokeSidebar ? 'lg:col-span-2' : 'max-w-3xl'}>
          <StepIndicator steps={STEP_LABELS} currentStep={step - 1} onStepClick={(i) => setStep(i + 1)} />

          <div className="min-h-[360px] py-2">
            {step === 1 && <BasicsStep form={form} set={set} editing={!!editing} durableTypes={unregisteredTypes} />}
            {step === 2 && <AccessStep form={form} set={set} />}
            {step === 3 && <SchemasStep form={form} set={set} />}
          </div>

          {(schemaError || upsert.error) && (
            <p className="text-xs text-status-error mt-4">
              {schemaError || (upsert.error as Error).message}
            </p>
          )}

          {/* Navigation */}
          <div className="flex justify-between items-center pt-4 border-t border-surface-border mt-4">
            <div>
              {step > 1 && (
                <button
                  onClick={() => setStep(step - 1)}
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
                  onClick={() => setStep(step + 1)}
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
