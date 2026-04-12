import { useState, useEffect, useCallback } from 'react';
import { Info } from 'lucide-react';
import {
  useMaintenanceConfig,
  useUpdateMaintenanceConfig,
  type MaintenanceConfig,
} from '../../../api/maintenance';
import { CRON_PRESETS } from '../../../lib/constants';
import { PruneFieldsEditor, DEFAULT_PRUNE_FIELDS, type PruneFields } from './controls';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a MaintenanceConfig (rules array) into PruneFields for the editor. */
function configToFields(config: MaintenanceConfig | undefined): PruneFields {
  if (!config?.rules?.length) return DEFAULT_PRUNE_FIELDS;
  const r = config.rules;
  const streamDelete = r.find((x) => x.target === 'streams' && x.action === 'delete');
  const jobDeleteTransient = r.find((x) => x.target === 'jobs' && x.action === 'delete' && x.hasEntity === false);
  const jobPrune = r.find((x) => x.target === 'jobs' && x.action === 'prune' && x.hasEntity === true);
  const jobDeletePruned = r.find((x) => x.target === 'jobs' && x.action === 'delete' && x.pruned === true);
  return {
    pruneJobs: !!jobDeletePruned,
    expire: jobDeletePruned?.olderThan ?? '180 days',
    engineStreams: !!streamDelete,
    engineStreamsExpire: streamDelete?.olderThan ?? '1 day',
    workerStreams: !!streamDelete,
    workerStreamsExpire: streamDelete?.olderThan ?? '90 days',
    stripAttributes: !!jobPrune,
    pruneTransient: !!jobDeleteTransient,
  };
}

/** Convert PruneFields back to a MaintenanceConfig rules array. */
function fieldsToRules(f: PruneFields): MaintenanceConfig['rules'] {
  const rules: MaintenanceConfig['rules'] = [];
  if (f.engineStreams) {
    rules.push({ target: 'streams', action: 'delete', olderThan: f.engineStreamsExpire });
  }
  if (f.workerStreams && f.workerStreamsExpire !== f.engineStreamsExpire) {
    rules.push({ target: 'streams', action: 'delete', olderThan: f.workerStreamsExpire });
  }
  if (f.pruneTransient) {
    rules.push({ target: 'jobs', action: 'delete', olderThan: f.expire, hasEntity: false });
  }
  if (f.stripAttributes) {
    rules.push({ target: 'jobs', action: 'prune', olderThan: f.expire, hasEntity: true });
  }
  if (f.pruneJobs) {
    rules.push({ target: 'jobs', action: 'delete', olderThan: f.expire, pruned: true });
  }
  return rules;
}

function describeCron(expr: string): string {
  return CRON_PRESETS.find((p) => p.value === expr)?.label ?? '';
}

// ── Main ────────────────────────────────────────────────────────────────────

export function ScheduleSection() {
  const { data, isLoading } = useMaintenanceConfig();
  const updateConfig = useUpdateMaintenanceConfig();

  const [schedule, setSchedule] = useState('');
  const [fields, setFields] = useState<PruneFields>(DEFAULT_PRUNE_FIELDS);
  const [savedSnapshot, setSavedSnapshot] = useState('');

  // Sync from server config when loaded
  const syncFromServer = useCallback(() => {
    if (!data?.config) return;
    setSchedule(data.config.schedule);
    setFields(configToFields(data.config));
    setSavedSnapshot(JSON.stringify({ schedule: data.config.schedule, fields: configToFields(data.config) }));
  }, [data]);

  useEffect(() => { syncFromServer(); }, [syncFromServer]);

  const currentSnapshot = JSON.stringify({ schedule, fields });
  const isDirty = savedSnapshot !== '' && currentSnapshot !== savedSnapshot;
  const active = data?.active ?? false;

  const handleSave = () => {
    const rules = fieldsToRules(fields);
    updateConfig.mutate(
      { schedule, rules },
      {
        onSuccess: () => {
          setSavedSnapshot(JSON.stringify({ schedule, fields }));
        },
      },
    );
  };

  const handleRevert = () => {
    syncFromServer();
  };

  if (isLoading) {
    return <div className="animate-pulse h-40 bg-surface-sunken rounded" />;
  }

  return (
    <div className="space-y-8">
      {/* Cron schedule + status */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-10">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-4">
            Schedule
          </p>
          <div className="flex items-end gap-4">
            <div>
              <label className="block text-[10px] text-text-tertiary mb-1">Cron Expression</label>
              <input
                type="text"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="0 2 * * *"
                className="input text-xs font-mono w-48"
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5 h-8">
                <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-status-success' : 'bg-text-tertiary'}`} />
                <span className={`text-xs ${active ? 'text-status-success' : 'text-text-tertiary'}`}>
                  {active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
            {describeCron(schedule) && (
              <p className="text-xs text-text-tertiary h-8 flex items-center">{describeCron(schedule)}</p>
            )}
          </div>

          {/* Preset pills */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {CRON_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setSchedule(preset.value)}
                className={`px-2.5 py-1 text-[10px] rounded-full transition-colors ${
                  schedule === preset.value
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'bg-surface-sunken text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:w-72">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-4">
            How It Works
          </p>
          <div className="flex items-start gap-2 px-3 py-2 rounded bg-surface-sunken">
            <Info className="w-3.5 h-3.5 text-text-tertiary shrink-0 mt-0.5" />
            <p className="text-[10px] text-text-tertiary leading-relaxed">
              Rules execute sequentially on each cron cycle. Engine streams can be pruned aggressively
              since they only contain internal routing data. Worker streams should be retained longer
              to preserve execution playback and input enrichment.
            </p>
          </div>
        </div>
      </div>

      {/* Same prune fields as Prune Now */}
      <PruneFieldsEditor fields={fields} onChange={setFields} />

      {/* Action bar */}
      <div className="flex items-center justify-between pt-2 border-t border-surface-border">
        <div className="flex items-center gap-3">
          {isDirty && (
            <button
              onClick={handleRevert}
              className="text-[10px] text-text-tertiary hover:text-text-primary transition-colors"
            >
              Revert changes
            </button>
          )}
          {updateConfig.error && (
            <p className="text-xs text-status-error">{(updateConfig.error as Error).message}</p>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={!isDirty || !schedule.trim() || updateConfig.isPending}
          className="btn-primary text-xs disabled:opacity-40 shrink-0"
        >
          {updateConfig.isPending ? 'Saving...' : 'Save Schedule'}
        </button>
      </div>
    </div>
  );
}
