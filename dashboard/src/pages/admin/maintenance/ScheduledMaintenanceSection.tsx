import { useState } from 'react';
import {
  useMaintenanceConfig,
  useUpdateMaintenanceConfig,
  type MaintenanceRule,
} from '../../../api/maintenance';
import { Modal } from '../../../components/common/Modal';
import { SectionLabel } from '../../../components/common/SectionLabel';
import { DataTable, type Column } from '../../../components/common/DataTable';

export function ScheduledMaintenanceSection() {
  const { data, isLoading } = useMaintenanceConfig();
  const updateConfig = useUpdateMaintenanceConfig();

  const [showEdit, setShowEdit] = useState(false);
  const [schedule, setSchedule] = useState('');
  const [rulesJson, setRulesJson] = useState('');
  const [jsonError, setJsonError] = useState('');

  const openEdit = () => {
    if (data?.config) {
      setSchedule(data.config.schedule);
      setRulesJson(JSON.stringify(data.config.rules, null, 2));
    } else {
      setSchedule('0 2 * * *');
      setRulesJson('[]');
    }
    setJsonError('');
    setShowEdit(true);
  };

  const handleSave = () => {
    setJsonError('');
    let rules: MaintenanceRule[];
    try {
      rules = JSON.parse(rulesJson);
      if (!Array.isArray(rules)) throw new Error('Rules must be an array');
    } catch (e: any) {
      setJsonError(e.message || 'Invalid JSON');
      return;
    }
    updateConfig.mutate(
      { schedule, rules },
      { onSuccess: () => setShowEdit(false) },
    );
  };

  const ruleColumns: Column<MaintenanceRule>[] = [
    {
      key: 'target',
      label: 'Target',
      render: (row) => (
        <span className="px-2 py-0.5 text-[10px] bg-surface-sunken rounded-full font-mono">
          {row.target}
        </span>
      ),
    },
    {
      key: 'action',
      label: 'Action',
      render: (row) => (
        <span className={`text-xs font-medium ${row.action === 'delete' ? 'text-status-error' : 'text-text-secondary'}`}>
          {row.action}
        </span>
      ),
    },
    {
      key: 'olderThan',
      label: 'Older Than',
      render: (row) => <span className="text-xs text-text-secondary">{row.olderThan}</span>,
    },
    {
      key: 'filter',
      label: 'Filter',
      render: (row) => {
        const parts: string[] = [];
        if (row.hasEntity === true) parts.push('entity jobs');
        if (row.hasEntity === false) parts.push('transient');
        if (row.pruned) parts.push('already pruned');
        return (
          <span className="text-xs text-text-tertiary">
            {parts.length > 0 ? parts.join(', ') : '\u2014'}
          </span>
        );
      },
    },
  ];

  return (
    <section>
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <SectionLabel>Cron Prune</SectionLabel>
          <p className="text-xs text-text-secondary mt-1">
            Automated pruning runs on a cron schedule. Rules execute sequentially each cycle.
          </p>
        </div>
        <button onClick={openEdit} className="btn-primary text-xs shrink-0">
          Edit Rules
        </button>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-20 bg-surface-sunken rounded" />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-6">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                Schedule
              </p>
              <p className="text-sm font-mono text-text-primary mt-1">
                {data?.config?.schedule ?? '\u2014'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                Status
              </p>
              <p className="text-sm mt-1">
                {data?.active ? (
                  <span className="text-status-success">Active</span>
                ) : (
                  <span className="text-text-tertiary">Inactive</span>
                )}
              </p>
            </div>
          </div>

          {data?.config?.rules && data.config.rules.length > 0 && (
            <DataTable
              columns={ruleColumns}
              data={data.config.rules}
              keyFn={(row) => `${row.target}-${row.action}-${row.olderThan}`}
              emptyMessage="No rules configured"
            />
          )}
        </div>
      )}

      {/* Edit maintenance config modal */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Maintenance Config">
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
              Cron Schedule
            </label>
            <input
              type="text"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="0 2 * * *"
              className="input text-xs font-mono w-full"
            />
            <p className="text-[10px] text-text-tertiary mt-1">
              Standard cron expression (e.g., "0 2 * * *" = daily at 2 AM)
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
              Rules (JSON)
            </label>
            <textarea
              value={rulesJson}
              onChange={(e) => setRulesJson(e.target.value)}
              className="input font-mono text-xs w-full"
              rows={12}
              spellCheck={false}
            />
            {jsonError && <p className="text-xs text-status-error mt-1">{jsonError}</p>}
            <p className="text-[10px] text-text-tertiary mt-1">
              Each rule: {'{'} target: "streams"|"jobs", action: "delete"|"prune", olderThan: "7 days", hasEntity?: bool, pruned?: bool {'}'}
            </p>
          </div>

          {updateConfig.error && (
            <p className="text-xs text-status-error">{(updateConfig.error as Error).message}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowEdit(false)} className="btn-secondary text-xs">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!schedule.trim() || updateConfig.isPending}
              className="btn-primary text-xs"
            >
              {updateConfig.isPending ? 'Saving...' : 'Save & Restart'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
