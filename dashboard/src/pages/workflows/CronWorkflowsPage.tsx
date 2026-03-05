import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkflowConfigs, useSetCronSchedule, useJobs } from '../../api/workflows';
import { useCronStatus } from '../../api/workflows';
import { PageHeader } from '../../components/common/PageHeader';
import { SectionLabel } from '../../components/common/SectionLabel';
import { Pill } from '../../components/common/Pill';
import { DataTable, type Column } from '../../components/common/DataTable';
import { TimeAgo } from '../../components/common/TimeAgo';
import { StatusBadge } from '../../components/common/StatusBadge';
import type { LTJob } from '../../api/types';

// ── Helpers ─────────────────────────────────────────────────────────────────

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

// ── Recent jobs table ───────────────────────────────────────────────────────

const jobColumns: Column<LTJob>[] = [
  {
    key: 'workflow_id',
    label: 'Workflow ID',
    render: (row) => (
      <span className="font-mono text-[11px] text-text-secondary">
        {row.workflow_id.length > 40
          ? `${row.workflow_id.slice(0, 40)}…`
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

// ── Component ───────────────────────────────────────────────────────────────

export function CronWorkflowsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: configs, isLoading } = useWorkflowConfigs();
  const { data: cronEntries } = useCronStatus();
  const setCron = useSetCronSchedule();

  const selectedType = searchParams.get('type') ?? '';
  const [cronInput, setCronInput] = useState('');

  // All invocable workflows are candidates for cron
  const invocable = (configs ?? []).filter((c) => c.invocable);
  const selected = invocable.find((c) => c.workflow_type === selectedType);

  // Active cron types from the server-side registry
  const activeTypes = new Set((cronEntries ?? []).filter((e) => e.active).map((e) => e.workflow_type));

  // Sync input when selection changes
  useEffect(() => {
    if (selected) {
      setCronInput(selected.cron_schedule ?? '');
      setCron.reset();
    }
  }, [selectedType]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: jobsData, isLoading: jobsLoading } = useJobs({
    entity: selectedType,
    limit: 10,
  });

  const handleSave = () => {
    if (!selected) return;
    setCron.mutate({
      config: selected,
      cron_schedule: cronInput.trim() || null,
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
      <PageHeader title="Cron Workflows" />

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

                {/* Envelope preview */}
                {selected.envelope_schema && (
                  <div>
                    <SectionLabel className="mb-2">Default Envelope</SectionLabel>
                    <pre className="bg-surface-sunken rounded-lg p-4 text-[11px] font-mono text-text-secondary leading-relaxed overflow-x-auto">
                      {JSON.stringify(selected.envelope_schema, null, 2)}
                    </pre>
                    <p className="text-[10px] text-text-tertiary mt-1.5">
                      Sent as the workflow input on each cron invocation
                    </p>
                  </div>
                )}

                {/* Recent executions */}
                <div>
                  <SectionLabel className="mb-3">Recent Executions</SectionLabel>
                  <DataTable
                    columns={jobColumns}
                    data={jobsData?.jobs ?? []}
                    keyFn={(row) => row.workflow_id}
                    onRowClick={(row) => navigate(`/workflows/detail/${row.workflow_id}`)}
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
