import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSetCronSchedule, useJobs } from '../../../api/workflows';
import { SectionLabel } from '../../../components/common/layout/SectionLabel';
import { Pill } from '../../../components/common/display/Pill';
import { DataTable } from '../../../components/common/data/DataTable';
import type { LTWorkflowConfig } from '../../../api/types/workflows';
import { DEFAULT_ENVELOPE, jobColumns } from './helpers';
import { CronScheduleEditor } from './CronScheduleEditor';
import { CronEnvelopeEditor } from './CronEnvelopeEditor';

interface CronDetailPanelProps {
  selected: LTWorkflowConfig;
  activeTypes: Set<string>;
}

export function CronDetailPanel({ selected, activeTypes }: CronDetailPanelProps) {
  const navigate = useNavigate();
  const setCron = useSetCronSchedule();

  const [cronInput, setCronInput] = useState('');
  const [envelopeInput, setEnvelopeInput] = useState('');
  const [envelopeError, setEnvelopeError] = useState('');

  // Default envelope string for the selected workflow
  const defaultEnvelope = useMemo(() => {
    if (!selected?.envelope_schema) return DEFAULT_ENVELOPE;
    return JSON.stringify(selected.envelope_schema, null, 2);
  }, [selected?.envelope_schema]); // eslint-disable-line react-hooks/exhaustive-deps

  const isEnvelopeModified = envelopeInput !== defaultEnvelope;

  // Sync input when selection changes
  useEffect(() => {
    setCronInput(selected.cron_schedule ?? '');
    setEnvelopeInput(
      selected.envelope_schema
        ? JSON.stringify(selected.envelope_schema, null, 2)
        : DEFAULT_ENVELOPE,
    );
    setEnvelopeError('');
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
    setCron.mutate({
      config: selected,
      cron_schedule: null,
    });
  };

  const handleResetEnvelope = () => {
    setEnvelopeInput(defaultEnvelope);
    setEnvelopeError('');
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

      <CronScheduleEditor
        cronInput={cronInput}
        setCronInput={setCronInput}
        setCron={setCron}
        hasCronSchedule={!!selected.cron_schedule}
        onSave={handleSave}
        onClear={handleClear}
      />

      <CronEnvelopeEditor
        key={selected.workflow_type}
        envelopeInput={envelopeInput}
        setEnvelopeInput={setEnvelopeInput}
        envelopeError={envelopeError}
        setEnvelopeError={setEnvelopeError}
        isEnvelopeModified={isEnvelopeModified}
        onResetEnvelope={handleResetEnvelope}
      />

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
