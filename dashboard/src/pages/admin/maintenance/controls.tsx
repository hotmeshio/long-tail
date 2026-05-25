import { Info, ShieldCheck, ShieldAlert, ShieldOff } from 'lucide-react';
import { RETENTION_PERIOD_OPTIONS } from '../../../lib/constants';

// ── Retention row (checkbox + label + select) ───────────────────────────────

export function RetentionRow({ checked, onToggle, label, hint, safety, value, onChange }: {
  checked: boolean;
  onToggle: (v: boolean) => void;
  label: string;
  hint: string;
  safety: 'safe' | 'moderate' | 'destructive';
  value: string;
  onChange: (v: string) => void;
}) {
  const SafetyIcon = safety === 'safe' ? ShieldCheck : safety === 'moderate' ? ShieldAlert : ShieldOff;
  const safetyColor = safety === 'safe' ? 'text-status-success' : safety === 'moderate' ? 'text-status-warning' : 'text-status-error';
  const safetyLabel = safety === 'safe' ? 'Safe' : safety === 'moderate' ? 'Careful' : 'Permanent';

  return (
    <div className="flex items-center gap-4">
      <label className="flex items-center gap-2.5 cursor-pointer w-80 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          className="w-4 h-4 rounded border-border accent-accent shrink-0"
        />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-primary">{label}</span>
            <span className={`flex items-center gap-0.5 text-[9px] ${safetyColor}`}>
              <SafetyIcon className="w-3 h-3" strokeWidth={1.5} />
              {safetyLabel}
            </span>
          </div>
          <p className="text-[10px] text-text-tertiary">{hint}</p>
        </div>
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!checked}
        className={`select text-xs w-36 transition-opacity ${!checked ? 'opacity-40 cursor-not-allowed' : ''}`}
      >
        {RETENTION_PERIOD_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

// ── Cleanup checkbox ────────────────────────────────────────────────────────

export function CleanupCheck({ checked, onChange, label, description, safety }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
  safety: 'safe' | 'moderate' | 'destructive';
}) {
  const SafetyIcon = safety === 'safe' ? ShieldCheck : safety === 'moderate' ? ShieldAlert : ShieldOff;
  const safetyColor = safety === 'safe' ? 'text-status-success' : safety === 'moderate' ? 'text-status-warning' : 'text-status-error';
  const safetyLabel = safety === 'safe' ? 'Safe' : safety === 'moderate' ? 'Careful' : 'Permanent';

  return (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 mt-0.5 rounded border-border accent-accent shrink-0"
      />
      <div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-primary">{label}</span>
          <span className={`flex items-center gap-0.5 text-[9px] ${safetyColor}`}>
            <SafetyIcon className="w-3 h-3" strokeWidth={1.5} />
            {safetyLabel}
          </span>
        </div>
        <p className="text-[10px] text-text-tertiary">{description}</p>
      </div>
    </label>
  );
}

// ── Cleanup callout ─────────────────────────────────────────────────────────

export function CleanupCallout() {
  return (
    <div className="flex items-start gap-2 mt-2 px-3 py-2 rounded bg-surface-sunken">
      <Info className="w-3.5 h-3.5 text-text-tertiary shrink-0 mt-0.5" />
      <p className="text-[10px] text-text-tertiary leading-relaxed">
        Stripping preserves workflow results and timeline data needed for the execution detail view.
        Transient jobs are internal bookkeeping that accumulates over time.
      </p>
    </div>
  );
}

// ── Prune fields state shape (shared between both panels) ───────────────────

export interface PruneFields {
  pruneJobs: boolean;
  expire: string;
  engineStreams: boolean;
  engineStreamsExpire: string;
  workerStreams: boolean;
  workerStreamsExpire: string;
  stripAttributes: boolean;
  pruneTransient: boolean;
}

export const DEFAULT_PRUNE_FIELDS: PruneFields = {
  pruneJobs: true,
  expire: '30 days',
  engineStreams: true,
  engineStreamsExpire: '1 day',
  workerStreams: true,
  workerStreamsExpire: '90 days',
  stripAttributes: false,
  pruneTransient: false,
};

export function hasSelection(f: PruneFields): boolean {
  return f.pruneJobs || f.engineStreams || f.workerStreams || f.stripAttributes || f.pruneTransient;
}

// ── Prune fields editor (reused by both Prune Now and Schedule) ─────────────

export function PruneFieldsEditor({ fields, onChange }: {
  fields: PruneFields;
  onChange: (f: PruneFields) => void;
}) {
  const set = <K extends keyof PruneFields>(key: K, value: PruneFields[K]) =>
    onChange({ ...fields, [key]: value });

  return (
    <div className="space-y-8">
      {/* Stream messages — always safe to prune */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
          Stream Messages
        </p>
        <p className="text-[10px] text-text-tertiary mb-4">
          Processed routing messages. Already consumed — safe to remove after a short retention window.
        </p>
        <div className="space-y-3">
          <RetentionRow
            checked={fields.engineStreams} onToggle={(v) => set('engineStreams', v)}
            label="Engine messages" hint="Internal orchestration signals"
            safety="safe"
            value={fields.engineStreamsExpire} onChange={(v) => set('engineStreamsExpire', v)}
          />
          <RetentionRow
            checked={fields.workerStreams} onToggle={(v) => set('workerStreams', v)}
            label="Worker messages" hint="Activity dispatch and response payloads"
            safety="safe"
            value={fields.workerStreamsExpire} onChange={(v) => set('workerStreamsExpire', v)}
          />
        </div>
      </div>

      {/* Workflow data — mutually exclusive: reduce OR delete */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
          Completed Workflows
        </p>
        <p className="text-[10px] text-text-tertiary mb-4">
          Choose how to handle completed workflow records. Reducing strips step-level detail
          but keeps the workflow and its results. Deleting removes the record entirely.
        </p>
        <div className="space-y-3">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="radio"
              name="workflow-cleanup"
              checked={!fields.stripAttributes && !fields.pruneJobs}
              onChange={() => onChange({ ...fields, stripAttributes: false, pruneJobs: false })}
              className="w-4 h-4 mt-0.5 accent-accent shrink-0"
            />
            <div>
              <span className="text-xs text-text-primary">Keep as-is</span>
              <p className="text-[10px] text-text-tertiary">No changes to completed workflow records.</p>
            </div>
          </label>

          <div className="flex items-start gap-2.5">
            <label className="flex items-start gap-2.5 cursor-pointer w-80 shrink-0">
              <input
                type="radio"
                name="workflow-cleanup"
                checked={fields.stripAttributes && !fields.pruneJobs}
                onChange={() => onChange({ ...fields, stripAttributes: true, pruneJobs: false })}
                className="w-4 h-4 mt-0.5 accent-accent shrink-0"
              />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-primary">Reduce completed workflows</span>
                  <span className="flex items-center gap-0.5 text-[9px] text-status-warning">
                    <ShieldAlert className="w-3 h-3" strokeWidth={1.5} />
                    Careful
                  </span>
                </div>
                <p className="text-[10px] text-text-tertiary">
                  Strips step-level execution detail (activity inputs/outputs, internal state).
                  Workflow results and timeline are preserved.
                </p>
              </div>
            </label>
            <select
              value={fields.expire}
              onChange={(e) => set('expire', e.target.value)}
              disabled={!fields.stripAttributes || fields.pruneJobs}
              className={`select text-xs w-36 transition-opacity mt-0.5 ${!fields.stripAttributes || fields.pruneJobs ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              {RETENTION_PERIOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-start gap-2.5">
            <label className="flex items-start gap-2.5 cursor-pointer w-80 shrink-0">
              <input
                type="radio"
                name="workflow-cleanup"
                checked={fields.pruneJobs}
                onChange={() => onChange({ ...fields, pruneJobs: true, stripAttributes: false })}
                className="w-4 h-4 mt-0.5 accent-accent shrink-0"
              />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-primary">Delete completed workflows</span>
                  <span className="flex items-center gap-0.5 text-[9px] text-status-error">
                    <ShieldOff className="w-3 h-3" strokeWidth={1.5} />
                    Permanent
                  </span>
                </div>
                <p className="text-[10px] text-text-tertiary">
                  Permanently removes workflow records. Results, timeline, and all
                  execution data are deleted and cannot be recovered.
                </p>
              </div>
            </label>
            <select
              value={fields.expire}
              onChange={(e) => set('expire', e.target.value)}
              disabled={!fields.pruneJobs}
              className={`select text-xs w-36 transition-opacity mt-0.5 ${!fields.pruneJobs ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              {RETENTION_PERIOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
        <CleanupCallout />
      </div>
    </div>
  );
}
