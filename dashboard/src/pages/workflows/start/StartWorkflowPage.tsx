import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Play, Clock, Bot, UserCircle } from 'lucide-react';
import { useWorkflowConfigs, useDiscoveredWorkflows, useInvokeWorkflow, useCronStatus, useSetCronSchedule, useJobs } from '../../../api/workflows';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { SectionLabel } from '../../../components/common/layout/SectionLabel';
import { Pill } from '../../../components/common/display/Pill';
import { DataTable } from '../../../components/common/data/DataTable';
import { BotPicker } from '../../../components/common/form/BotPicker';
import { useAuth } from '../../../hooks/useAuth';
import type { LTWorkflowConfig } from '../../../api/types';
import {
  DEFAULT_ENVELOPE,
  extractDataFields,
  dataToFields,
  fieldsToJson,
} from './helpers';
import { describeCron, COMMON_PATTERNS, extractFormFields, jobColumns } from '../cron/helpers';
import { WorkflowSelector } from './WorkflowSelector';
import { EnvelopeEditor } from './EnvelopeEditor';

export type InvokeTier = 'unbreakable' | 'durable';
type Mode = 'now' | 'schedule';

// ── Mode toggle ─────────────────────────────────────────────────────────────

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const btn = (m: Mode, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => onChange(m)}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
        mode === m
          ? 'bg-accent/10 text-accent font-medium'
          : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-hover'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="flex gap-1 p-0.5 bg-surface-sunken rounded-lg w-fit">
      {btn('now', <Play className="w-3.5 h-3.5" />, 'Start Now')}
      {btn('schedule', <Clock className="w-3.5 h-3.5" />, 'Schedule')}
    </div>
  );
}

// ── Identity summary ────────────────────────────────────────────────────────

function IdentitySummary({
  config,
  overrideBot,
  onOverrideChange,
  showOverride,
}: {
  config: LTWorkflowConfig;
  overrideBot?: string;
  onOverrideChange?: (botExternalId: string) => void;
  showOverride?: boolean;
}) {
  const { user } = useAuth();
  const effectiveBot = overrideBot || config.execute_as;

  return (
    <div className="bg-surface-sunken rounded-lg px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium">Running as</span>
        {effectiveBot && !overrideBot && (
          <span className="text-[9px] text-text-tertiary">configured default</span>
        )}
        {overrideBot && (
          <span className="text-[9px] text-accent">admin override</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {effectiveBot ? (
          <>
            <Bot className="w-3.5 h-3.5 text-accent/70" />
            <span className="text-xs text-text-primary font-mono">{effectiveBot}</span>
          </>
        ) : (
          <>
            <UserCircle className="w-3.5 h-3.5 text-text-tertiary" />
            <span className="text-xs text-text-primary">
              {user?.displayName || user?.username || 'you'}
            </span>
          </>
        )}
      </div>
      {showOverride && onOverrideChange && (
        <div className="pt-1 border-t border-surface-border">
          <label className="text-[10px] text-text-tertiary mb-1 block">Override identity</label>
          <BotPicker
            selected={overrideBot ?? ''}
            onChange={onOverrideChange}
            placeholder={config.execute_as ? `Default: ${config.execute_as}` : 'Invoking user (default)'}
          />
        </div>
      )}
    </div>
  );
}

// ── Schedule panel ──────────────────────────────────────────────────────────

function SchedulePanel({
  selected,
  activeTypes,
}: {
  selected: LTWorkflowConfig;
  activeTypes: Set<string>;
}) {
  const navigate = useNavigate();
  const setCron = useSetCronSchedule();

  const [cronInput, setCronInput] = useState('');
  const [envelopeInput, setEnvelopeInput] = useState('');
  const [envelopeError, setEnvelopeError] = useState('');
  const [viewMode, setViewMode] = useState<'json' | 'form'>('json');

  const defaultEnvelope = useMemo(() => {
    if (!selected?.envelope_schema) return DEFAULT_ENVELOPE;
    return JSON.stringify(selected.envelope_schema, null, 2);
  }, [selected?.envelope_schema]);

  const isEnvelopeModified = envelopeInput !== defaultEnvelope;

  const parsedEnvelope = useMemo(() => {
    try {
      return JSON.parse(envelopeInput) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [envelopeInput]);

  const formFields = useMemo(
    () => (parsedEnvelope ? extractFormFields(parsedEnvelope) : null),
    [parsedEnvelope],
  );

  useEffect(() => {
    setCronInput(selected.cron_schedule ?? '');
    setEnvelopeInput(
      selected.envelope_schema
        ? JSON.stringify(selected.envelope_schema, null, 2)
        : DEFAULT_ENVELOPE,
    );
    setEnvelopeError('');
    setViewMode('json');
    setCron.reset();
  }, [selected.workflow_type]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: jobsData, isLoading: jobsLoading } = useJobs({
    entity: selected.workflow_type,
    limit: 10,
  });

  const handleSave = () => {
    let envelopeSchema: Record<string, unknown> | undefined;
    try {
      envelopeSchema = JSON.parse(envelopeInput);
    } catch {
      setEnvelopeError('Invalid JSON in envelope');
      return;
    }
    setEnvelopeError('');
    setCron.mutate({
      config: selected,
      cron_schedule: cronInput.trim() || null,
      envelope_schema: envelopeSchema,
    });
  };

  const handleClear = () => {
    setCronInput('');
    setCron.mutate({ config: selected, cron_schedule: null });
  };

  const handleResetEnvelope = () => {
    setEnvelopeInput(defaultEnvelope);
    setEnvelopeError('');
  };

  const handleFormFieldChange = (key: string, value: string) => {
    if (!parsedEnvelope) return;
    const data = { ...((parsedEnvelope.data as Record<string, unknown>) ?? {}) };
    const original = data[key];
    if (typeof original === 'number') data[key] = value === '' ? 0 : Number(value);
    else if (typeof original === 'boolean') data[key] = value === 'true';
    else data[key] = value;
    setEnvelopeInput(JSON.stringify({ ...parsedEnvelope, data }, null, 2));
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <SectionLabel>{selected.workflow_type}</SectionLabel>
          {selected.cron_schedule && (
            <Pill className={activeTypes.has(selected.workflow_type)
              ? 'bg-status-success/10 text-status-success'
              : 'bg-surface-sunken text-text-tertiary'
            }>
              {activeTypes.has(selected.workflow_type) ? 'active' : 'inactive'}
            </Pill>
          )}
        </div>
        {selected.description && (
          <p className="text-xs text-text-tertiary mt-2 leading-relaxed">
            {selected.description}
          </p>
        )}
      </div>

      {/* Cron execution identity */}
      <div className="bg-surface-sunken rounded-lg px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium mr-2">Cron runs as</span>
          <Bot className="w-3.5 h-3.5 text-accent/70" />
          <span className="text-xs text-text-primary font-mono">
            {selected.execute_as ?? 'lt-system'}
          </span>
          {!selected.execute_as && (
            <span className="text-[9px] text-text-tertiary ml-1">system bot</span>
          )}
        </div>
      </div>

      {/* Cron editor */}
      <div>
        <SectionLabel className="mb-3">Schedule</SectionLabel>
        <div className="flex gap-3 items-start">
          <div className="flex-1">
            <input
              type="text"
              value={cronInput}
              onChange={(e) => { setCronInput(e.target.value); setCron.reset(); }}
              placeholder="0 */6 * * *"
              className="input font-mono text-sm w-full"
            />
            {cronInput.trim() && describeCron(cronInput.trim()) && (
              <p className="text-xs text-text-secondary mt-1.5">
                {describeCron(cronInput.trim())}
              </p>
            )}
          </div>
          <button onClick={handleSave} disabled={setCron.isPending} className="btn-primary text-xs shrink-0">
            {setCron.isPending ? 'Saving...' : 'Save'}
          </button>
          {selected.cron_schedule && (
            <button onClick={handleClear} disabled={setCron.isPending} className="btn-ghost text-xs text-status-error shrink-0">
              Clear
            </button>
          )}
        </div>
        {setCron.isSuccess && <p className="text-[10px] text-status-success mt-2">Schedule updated</p>}
        {setCron.error && <p className="text-[10px] text-status-error mt-2">{setCron.error.message}</p>}
      </div>

      {/* Common patterns */}
      <div className="bg-surface-sunken rounded-lg p-4">
        <SectionLabel className="mb-2">Common Patterns</SectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5">
          {COMMON_PATTERNS.map(([expr, desc]) => (
            <button
              key={expr}
              type="button"
              onClick={() => { setCronInput(expr); setCron.reset(); }}
              className="flex items-center gap-2 text-left py-0.5 group"
            >
              <code className="font-mono text-[11px] text-accent group-hover:text-accent-hover">{expr}</code>
              <span className="text-[10px] text-text-tertiary">{desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Cron Envelope editor */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <SectionLabel>Cron Envelope</SectionLabel>
          <div className="flex items-center gap-3">
            {isEnvelopeModified && (
              <button type="button" onClick={handleResetEnvelope} className="text-[10px] text-status-warning hover:text-status-warning/80 transition-colors">
                Reset to default
              </button>
            )}
            {formFields && (
              <div className="flex rounded overflow-hidden border border-surface-border">
                <button type="button" onClick={() => setViewMode('form')} className={`px-2 py-0.5 text-[10px] transition-colors ${viewMode === 'form' ? 'bg-accent/10 text-accent' : 'text-text-tertiary hover:text-text-secondary'}`}>Form</button>
                <button type="button" onClick={() => setViewMode('json')} className={`px-2 py-0.5 text-[10px] transition-colors ${viewMode === 'json' ? 'bg-accent/10 text-accent' : 'text-text-tertiary hover:text-text-secondary'}`}>JSON</button>
              </div>
            )}
          </div>
        </div>
        <p className="text-[10px] text-text-tertiary mb-3">
          This envelope is sent as the workflow input on each cron invocation.
        </p>

        {viewMode === 'form' && formFields ? (
          <div className="space-y-3">
            {formFields.map(({ key, value, type }) => (
              <div key={key}>
                <label className="block text-[11px] text-text-secondary mb-1 font-mono">{key}</label>
                {type === 'boolean' ? (
                  <select value={value} onChange={(e) => handleFormFieldChange(key, e.target.value)} className="input text-xs w-full">
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input type={type === 'number' ? 'number' : 'text'} value={value} onChange={(e) => handleFormFieldChange(key, e.target.value)} className="input text-xs font-mono w-full" />
                )}
              </div>
            ))}
          </div>
        ) : (
          <textarea
            value={envelopeInput}
            onChange={(e) => { setEnvelopeInput(e.target.value); setEnvelopeError(''); }}
            className="input font-mono text-xs w-full"
            rows={10}
            spellCheck={false}
          />
        )}

        {envelopeError && <p className="text-[10px] text-status-error mt-2">{envelopeError}</p>}
        {isEnvelopeModified && <p className="text-[10px] text-accent mt-1.5">Envelope has been customized. Changes will be saved with the schedule.</p>}
      </div>

      {/* Recent executions */}
      <div>
        <SectionLabel className="mb-3">Recent Executions</SectionLabel>
        <DataTable
          columns={jobColumns}
          data={jobsData?.jobs ?? []}
          keyFn={(row) => row.workflow_id}
          onRowClick={(row) => navigate(`/workflows/executions/${row.workflow_id}`)}
          isLoading={jobsLoading}
          emptyMessage="No executions yet"
        />
      </div>
    </div>
  );
}

// ── Start Now panel ─────────────────────────────────────────────────────────

function StartNowPanel({ selected, executionsPath }: { selected: LTWorkflowConfig; executionsPath: string }) {
  const navigate = useNavigate();
  const { isSuperAdmin, hasRoleType } = useAuth();
  const isAdmin = isSuperAdmin || hasRoleType('admin');
  const invokeMutation = useInvokeWorkflow();
  const [jsonInput, setJsonInput] = useState(DEFAULT_ENVELOPE);
  const [parseError, setParseError] = useState('');
  const [formFields, setFormFields] = useState<Record<string, unknown>>({});
  const [isJsonMode, setIsJsonMode] = useState(false);
  const [overrideBot, setOverrideBot] = useState('');

  const dataFields = useMemo(
    () => extractDataFields(selected.envelope_schema ?? null),
    [selected.envelope_schema],
  );
  const hasFormView = dataFields.length > 0;

  const schemaMetadata = useMemo(() => {
    if (!selected.envelope_schema) return {};
    const md = selected.envelope_schema.metadata;
    return md && typeof md === 'object' ? (md as Record<string, unknown>) : {};
  }, [selected.envelope_schema]);

  useEffect(() => {
    setParseError('');
    invokeMutation.reset();
    const json = selected.envelope_schema
      ? JSON.stringify(selected.envelope_schema, null, 2)
      : DEFAULT_ENVELOPE;
    setJsonInput(json);
    if (selected.envelope_schema?.data && typeof selected.envelope_schema.data === 'object') {
      setFormFields(dataToFields(selected.envelope_schema.data as Record<string, unknown>));
    } else {
      setFormFields({});
    }
    setIsJsonMode(!extractDataFields(selected.envelope_schema ?? null).length);
    setOverrideBot('');
  }, [selected.workflow_type]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleMode = () => {
    if (isJsonMode) {
      try {
        const parsed = JSON.parse(jsonInput);
        if (parsed.data && typeof parsed.data === 'object') setFormFields(dataToFields(parsed.data));
      } catch { /* keep existing */ }
    } else {
      setJsonInput(fieldsToJson(formFields, schemaMetadata));
    }
    setIsJsonMode(!isJsonMode);
  };

  const updateFormField = (key: string, value: unknown, type: string) => {
    let parsed = value;
    if (type === 'number') parsed = value === '' ? 0 : Number(value);
    else if (type === 'boolean') parsed = value === 'true' || value === true;
    const updated = { ...formFields, [key]: parsed };
    setFormFields(updated);
    setJsonInput(fieldsToJson(updated, schemaMetadata));
  };

  const handleInvoke = async () => {
    setParseError('');
    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(jsonInput);
    } catch {
      setParseError('Invalid JSON');
      return;
    }
    const { data, metadata } = envelope;
    if (!data || typeof data !== 'object') {
      setParseError('Envelope must include a "data" object');
      return;
    }
    try {
      await invokeMutation.mutateAsync({
        workflowType: selected.workflow_type,
        data: data as Record<string, unknown>,
        metadata: (metadata as Record<string, unknown>) ?? undefined,
        ...(overrideBot ? { execute_as: overrideBot } : {}),
      });
      navigate(executionsPath);
    } catch { /* error via mutation */ }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between">
          <SectionLabel>{selected.workflow_type}</SectionLabel>
          <div className="flex gap-2">
            {selected.roles.map((r) => (
              <Pill key={r}>{r}</Pill>
            ))}
          </div>
        </div>
        {selected.description && (
          <p className="text-sm text-text-secondary mt-2 leading-relaxed">
            {selected.description}
          </p>
        )}
      </div>

      <IdentitySummary
        config={selected}
        overrideBot={overrideBot}
        onOverrideChange={setOverrideBot}
        showOverride={isAdmin}
      />

      <EnvelopeEditor
        selectedConfig={selected}
        isJsonMode={isJsonMode}
        hasFormView={hasFormView}
        jsonInput={jsonInput}
        formFields={formFields}
        dataFields={dataFields}
        onJsonChange={(v) => { setJsonInput(v); setParseError(''); }}
        onToggleMode={handleToggleMode}
        onUpdateFormField={updateFormField}
        onSetFormFields={setFormFields}
      />

      {parseError && <p className="text-xs text-status-error">{parseError}</p>}
      {invokeMutation.error && <p className="text-xs text-status-error">{invokeMutation.error.message}</p>}
      {invokeMutation.isSuccess && <p className="text-xs text-status-success">Workflow started</p>}

      <button onClick={handleInvoke} disabled={invokeMutation.isPending} className="btn-primary">
        {invokeMutation.isPending ? 'Starting...' : 'Start Workflow'}
      </button>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export function StartWorkflowPage({ tier = 'unbreakable' }: { tier?: InvokeTier }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: configsData, isLoading } = useWorkflowConfigs();
  const { data: discoveredData, isLoading: discoveredLoading } = useDiscoveredWorkflows();
  const { data: cronEntries } = useCronStatus();

  const mode = (searchParams.get('mode') as Mode) || 'now';
  const selectedType = searchParams.get('type') ?? '';

  const configs: LTWorkflowConfig[] = configsData ?? [];

  // Build the workflow list based on tier
  const invocableConfigs = useMemo(() => {
    if (tier === 'unbreakable') {
      // Registered configs with invocable: true
      return configs.filter((c) => c.invocable);
    }
    // Durable: active workers that have NO config entry
    const registeredTypes = new Set(configs.map((c) => c.workflow_type));
    const discovered = discoveredData ?? [];
    return discovered
      .filter((dw) => dw.active && !registeredTypes.has(dw.workflow_type))
      .map((dw) => ({
        workflow_type: dw.workflow_type,
        task_queue: dw.task_queue ?? '',
        invocable: true,
        description: null,
        default_role: 'reviewer',
        roles: [],
        invocation_roles: [],
        consumes: [],
        envelope_schema: null,
        resolver_schema: null,
        cron_schedule: null,
        execute_as: null,
      } satisfies LTWorkflowConfig));
  }, [tier, configs, discoveredData]);

  const selectedConfig = invocableConfigs.find((c) => c.workflow_type === selectedType);

  const activeTypes = new Set(
    (cronEntries ?? []).filter((e) => e.active).map((e) => e.workflow_type),
  );

  const executionsPath = tier === 'durable'
    ? '/workflows/durable/executions'
    : '/workflows/executions';

  // Auto-select first workflow if only one exists
  useEffect(() => {
    if (invocableConfigs.length === 1 && !searchParams.get('type')) {
      setSearchParams({ type: invocableConfigs[0].workflow_type, mode }, { replace: true });
    }
  }, [invocableConfigs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const setMode = (m: Mode) => {
    const params: Record<string, string> = { mode: m };
    if (selectedType) params.type = selectedType;
    setSearchParams(params, { replace: true });
  };

  const handleSelect = (config: LTWorkflowConfig) => {
    setSearchParams({ type: config.workflow_type, mode }, { replace: true });
  };

  if (isLoading || discoveredLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-40 bg-surface-sunken rounded" />
      </div>
    );
  }

  const emptyTitle = tier === 'durable'
    ? 'No active durable workers'
    : 'No invocable workflows';
  const emptyHint = tier === 'durable'
    ? 'Start the server with examples: true to load example durable workers.'
    : 'Mark workflows as invocable in the registry to enable them here.';

  return (
    <div>
      <PageHeader
        title={tier === 'durable' ? 'Invoke Durable Workflow' : 'Invoke Unbreakable Workflow'}
        actions={tier === 'unbreakable' ? <ModeToggle mode={mode} onChange={setMode} /> : undefined}
      />

      {invocableConfigs.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-text-primary mb-1">{emptyTitle}</p>
          <p className="text-xs text-text-tertiary">{emptyHint}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          <WorkflowSelector
            configs={invocableConfigs}
            selectedType={selectedType}
            onSelect={handleSelect}
          />

          <div className="lg:col-span-2">
            {selectedType && selectedConfig ? (
              mode === 'now' || tier === 'durable' ? (
                <StartNowPanel selected={selectedConfig} executionsPath={executionsPath} />
              ) : (
                <SchedulePanel selected={selectedConfig} activeTypes={activeTypes} />
              )
            ) : (
              <div className="py-16 text-center">
                <p className="text-sm text-text-tertiary">
                  Select a workflow to begin
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
