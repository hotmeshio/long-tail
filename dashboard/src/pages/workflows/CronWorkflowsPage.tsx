import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkflowConfigs, useSetCronSchedule, useJobs } from '../../api/workflows';
import { useCronStatus } from '../../api/workflows';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { SectionLabel } from '../../components/common/layout/SectionLabel';
import { Pill } from '../../components/common/display/Pill';
import { DataTable, type Column } from '../../components/common/data/DataTable';
import { TimeAgo } from '../../components/common/display/TimeAgo';
import { StatusBadge } from '../../components/common/display/StatusBadge';
import type { LTJob } from '../../api/types';

// -- Helpers -----------------------------------------------------------------

const CRON_DESCRIPTIONS: Record<string, string> = {
  '* * * * *': 'Every minute',
  '*/5 * * * *': 'Every 5 minutes',
  '*/15 * * * *': 'Every 15 minutes',
  '*/30 * * * *': 'Every 30 minutes',
  '0 * * * *': 'Every hour',
  '0 */2 * * *': 'Every 2 hours',
  '0 */6 * * *': 'Every 6 hours',
  '0 */12 * * *': 'Every 12 hours',
  '0 0 * * *': 'Daily at midnight',
  '0 9 * * *': 'Daily at 9 AM',
  '0 9 * * 1-5': 'Weekdays at 9 AM',
  '0 0 * * 0': 'Weekly (Sunday midnight)',
  '0 0 1 * *': 'Monthly (1st at midnight)',
  '0 2 * * *': 'Daily at 2 AM',
};

function describeCron(expr: string): string {
  return CRON_DESCRIPTIONS[expr] ?? '';
}

const COMMON_PATTERNS: [string, string][] = [
  ['*/15 * * * *', 'Every 15 min'],
  ['0 * * * *', 'Every hour'],
  ['0 */6 * * *', 'Every 6 hours'],
  ['0 9 * * *', 'Daily 9 AM'],
  ['0 9 * * 1-5', 'Weekdays 9 AM'],
  ['0 0 * * 0', 'Weekly (Sun)'],
];

const DEFAULT_ENVELOPE = '{\n  "data": {},\n  "metadata": {}\n}';

/** Extract simple string/number/boolean keys from `data` for form view. */
function extractFormFields(
  envelope: Record<string, unknown>,
): { key: string; value: string; type: string }[] | null {
  const data = envelope?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) return null;
  // Only show form if all values are scalar
  const allScalar = entries.every(
    ([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null,
  );
  if (!allScalar) return null;
  return entries.map(([key, value]) => ({
    key,
    value: value === null ? '' : String(value),
    type: value === null ? 'string' : typeof value,
  }));
}

// -- Recent jobs table -------------------------------------------------------

const jobColumns: Column<LTJob>[] = [
  {
    key: 'workflow_id',
    label: 'Workflow ID',
    render: (row) => (
      <span className="font-mono text-[11px] text-text-secondary">
        {row.workflow_id.length > 40
          ? `${row.workflow_id.slice(0, 40)}...`
          : row.workflow_id}
      </span>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    render: (row) => <StatusBadge status={row.status} />,
    className: 'w-28',
  },
  {
    key: 'created_at',
    label: 'Started',
    render: (row) => <TimeAgo date={row.created_at} />,
    className: 'w-32',
  },
];

// -- Component ---------------------------------------------------------------

export function CronWorkflowsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: configs, isLoading } = useWorkflowConfigs();
  const { data: cronEntries } = useCronStatus();
  const setCron = useSetCronSchedule();

  const selectedType = searchParams.get('type') ?? '';
  const [cronInput, setCronInput] = useState('');
  const [envelopeInput, setEnvelopeInput] = useState('');
  const [envelopeError, setEnvelopeError] = useState('');
  const [viewMode, setViewMode] = useState<'json' | 'form'>('json');

  // All invocable workflows are candidates for cron
  const invocable = (configs ?? []).filter((c) => c.invocable);
  const selected = invocable.find((c) => c.workflow_type === selectedType);

  // Active cron types from the server-side registry
  const activeTypes = new Set((cronEntries ?? []).filter((e) => e.active).map((e) => e.workflow_type));

  // Default envelope string for the selected workflow
  const defaultEnvelope = useMemo(() => {
    if (!selected?.envelope_schema) return DEFAULT_ENVELOPE;
    return JSON.stringify(selected.envelope_schema, null, 2);
  }, [selected?.envelope_schema]); // eslint-disable-line react-hooks/exhaustive-deps

  const isEnvelopeModified = envelopeInput !== defaultEnvelope;

  // Parse current envelope for form view
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

  // Sync input when selection changes
  useEffect(() => {
    if (selected) {
      setCronInput(selected.cron_schedule ?? '');
      setEnvelopeInput(
        selected.envelope_schema
          ? JSON.stringify(selected.envelope_schema, null, 2)
          : DEFAULT_ENVELOPE,
      );
      setEnvelopeError('');
      setViewMode('json');
      setCron.reset();
    }
  }, [selectedType]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: jobsData, isLoading: jobsLoading } = useJobs({
    entity: selectedType,
    limit: 10,
  });

  const handleSave = () => {
    if (!selected) return;

    // Validate envelope JSON
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
    if (!selected) return;
    setCronInput('');
    setCron.mutate({
      config: selected,
      cron_schedule: null,
    });
  };

  const handleResetEnvelope = () => {
    setEnvelopeInput(defaultEnvelope);
    setEnvelopeError('');
  };

  /** Update a single form field and sync back to JSON */
  const handleFormFieldChange = (key: string, value: string) => {
    if (!parsedEnvelope) return;
    const data = { ...((parsedEnvelope.data as Record<string, unknown>) ?? {}) };
    // Preserve original type
    const original = data[key];
    if (typeof original === 'number') {
      data[key] = value === '' ? 0 : Number(value);
    } else if (typeof original === 'boolean') {
      data[key] = value === 'true';
    } else {
      data[key] = value;
    }
    const updated = { ...parsedEnvelope, data };
    setEnvelopeInput(JSON.stringify(updated, null, 2));
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-40 bg-surface-sunken rounded" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Cron" />

      {invocable.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-text-primary mb-1">No invocable workflows</p>
          <p className="text-xs text-text-tertiary">
            Mark workflows as invocable in Workflow Configs to enable cron scheduling.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Workflow selector */}
          <div>
            <SectionLabel className="mb-6">Invocable Workflows</SectionLabel>
            <div>
              {invocable.map((config) => {
                const isSelected = selectedType === config.workflow_type;
                const hasCron = !!config.cron_schedule;
                const isActive = activeTypes.has(config.workflow_type);
                return (
                  <button
                    key={config.workflow_type}
                    onClick={() => setSearchParams({ type: config.workflow_type }, { replace: true })}
                    className={`w-full text-left py-4 border-b border-surface-border transition-colors duration-150 ${
                      isSelected
                        ? 'border-l-2 border-l-accent pl-4'
                        : 'pl-0 hover:text-text-primary'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-mono ${isSelected ? 'font-medium text-accent' : 'text-text-secondary'}`}>
                        {config.workflow_type}
                      </p>
                      {hasCron && (
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          isActive ? 'bg-status-success' : 'bg-status-warning'
                        }`} />
                      )}
                    </div>
                    {hasCron ? (
                      <p className="text-[11px] font-mono text-text-tertiary mt-1">
                        {config.cron_schedule}
                        {describeCron(config.cron_schedule!) && (
                          <span className="font-sans ml-2 text-text-tertiary/60">
                            {describeCron(config.cron_schedule!)}
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="text-[11px] text-text-tertiary/50 mt-1">No schedule</p>
                    )}
                    {config.description && (
                      <p className="text-[11px] text-text-tertiary mt-1 leading-relaxed">
                        {config.description}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-2">
            {selected ? (
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

                {/* Cron editor */}
                <div>
                  <SectionLabel className="mb-3">Schedule</SectionLabel>
                  <div className="flex gap-3 items-start">
                    <div className="flex-1">
                      <input
                        type="text"
                        value={cronInput}
                        onChange={(e) => {
                          setCronInput(e.target.value);
                          setCron.reset();
                        }}
                        placeholder="0 */6 * * *"
                        className="input font-mono text-sm w-full"
                      />
                      {cronInput.trim() && describeCron(cronInput.trim()) && (
                        <p className="text-xs text-text-secondary mt-1.5">
                          {describeCron(cronInput.trim())}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={handleSave}
                      disabled={setCron.isPending}
                      className="btn-primary text-xs shrink-0"
                    >
                      {setCron.isPending ? 'Saving...' : 'Save'}
                    </button>
                    {selected.cron_schedule && (
                      <button
                        onClick={handleClear}
                        disabled={setCron.isPending}
                        className="btn-ghost text-xs text-status-error shrink-0"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {setCron.isSuccess && (
                    <p className="text-[10px] text-status-success mt-2">Schedule updated</p>
                  )}
                  {setCron.error && (
                    <p className="text-[10px] text-status-error mt-2">{setCron.error.message}</p>
                  )}
                </div>

                {/* Common patterns */}
                <div className="bg-surface-sunken rounded-lg p-4">
                  <SectionLabel className="mb-2">Common Patterns</SectionLabel>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5">
                    {COMMON_PATTERNS.map(([expr, desc]) => (
                      <button
                        key={expr}
                        type="button"
                        onClick={() => {
                          setCronInput(expr);
                          setCron.reset();
                        }}
                        className="flex items-center gap-2 text-left py-0.5 group"
                      >
                        <code className="font-mono text-[11px] text-accent group-hover:text-accent-hover">
                          {expr}
                        </code>
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
                        <button
                          type="button"
                          onClick={handleResetEnvelope}
                          className="text-[10px] text-status-warning hover:text-status-warning/80 transition-colors"
                        >
                          Reset to default
                        </button>
                      )}
                      {formFields && (
                        <div className="flex rounded overflow-hidden border border-surface-border">
                          <button
                            type="button"
                            onClick={() => setViewMode('form')}
                            className={`px-2 py-0.5 text-[10px] transition-colors ${
                              viewMode === 'form'
                                ? 'bg-accent/10 text-accent'
                                : 'text-text-tertiary hover:text-text-secondary'
                            }`}
                          >
                            Form
                          </button>
                          <button
                            type="button"
                            onClick={() => setViewMode('json')}
                            className={`px-2 py-0.5 text-[10px] transition-colors ${
                              viewMode === 'json'
                                ? 'bg-accent/10 text-accent'
                                : 'text-text-tertiary hover:text-text-secondary'
                            }`}
                          >
                            JSON
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="text-[10px] text-text-tertiary mb-3">
                    This envelope is sent as the workflow input on each cron invocation. Edit to customize.
                  </p>

                  {viewMode === 'form' && formFields ? (
                    <div className="space-y-3">
                      {formFields.map(({ key, value, type }) => (
                        <div key={key}>
                          <label className="block text-[11px] text-text-secondary mb-1 font-mono">
                            {key}
                          </label>
                          {type === 'boolean' ? (
                            <select
                              value={value}
                              onChange={(e) => handleFormFieldChange(key, e.target.value)}
                              className="input text-xs w-full"
                            >
                              <option value="true">true</option>
                              <option value="false">false</option>
                            </select>
                          ) : (
                            <input
                              type={type === 'number' ? 'number' : 'text'}
                              value={value}
                              onChange={(e) => handleFormFieldChange(key, e.target.value)}
                              className="input text-xs font-mono w-full"
                            />
                          )}
                        </div>
                      ))}
                      {/* Show metadata as read-only hint if present */}
                      {parsedEnvelope?.metadata != null && typeof parsedEnvelope.metadata === 'object' && Object.keys(parsedEnvelope.metadata as Record<string, unknown>).length > 0 && (
                        <p className="text-[10px] text-text-tertiary mt-2">
                          Metadata fields are editable in JSON view.
                        </p>
                      )}
                    </div>
                  ) : (
                    <textarea
                      value={envelopeInput}
                      onChange={(e) => {
                        setEnvelopeInput(e.target.value);
                        setEnvelopeError('');
                      }}
                      className="input font-mono text-xs w-full"
                      rows={10}
                      spellCheck={false}
                    />
                  )}

                  {envelopeError && (
                    <p className="text-[10px] text-status-error mt-2">{envelopeError}</p>
                  )}
                  {isEnvelopeModified && (
                    <p className="text-[10px] text-accent mt-1.5">
                      Envelope has been customized. Changes will be saved with the schedule.
                    </p>
                  )}
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
            ) : (
              <div className="py-16 text-center">
                <p className="text-sm text-text-tertiary">
                  Select a workflow to configure its cron schedule
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
