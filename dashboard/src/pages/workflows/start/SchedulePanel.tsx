import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { useSetCronSchedule, useJobs } from '../../../api/workflows';
import { SectionLabel } from '../../../components/common/layout/SectionLabel';
import { Pill } from '../../../components/common/display/Pill';
import { DataTable } from '../../../components/common/data/DataTable';
import type { LTWorkflowConfig } from '../../../api/types';
import { DEFAULT_ENVELOPE } from './helpers';
import { describeCron, COMMON_PATTERNS, extractFormFields, jobColumns } from '../cron/helpers';

export function SchedulePanel({
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
