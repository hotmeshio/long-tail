import { Info } from 'lucide-react';
import { RETENTION_PERIOD_OPTIONS } from '../../../lib/constants';

// ── Retention row (checkbox + label + select) ───────────────────────────────

export function RetentionRow({ checked, onToggle, label, hint, value, onChange }: {
  checked: boolean;
  onToggle: (v: boolean) => void;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <label className="flex items-center gap-2.5 cursor-pointer w-64 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          className="w-4 h-4 rounded border-border accent-accent shrink-0"
        />
        <div>
          <span className="text-xs text-text-primary">{label}</span>
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

export function CleanupCheck({ checked, onChange, label, description }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 mt-0.5 rounded border-border accent-accent shrink-0"
      />
      <div>
        <span className="text-xs text-text-primary">{label}</span>
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
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-10">
      {/* Left: delete data — the aligned 3 */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-4">
          Delete Expired Data
        </p>
        <div className="space-y-3">
          <RetentionRow
            checked={fields.pruneJobs} onToggle={(v) => set('pruneJobs', v)}
            label="Jobs" hint="Hard-delete completed job rows"
            value={fields.expire} onChange={(v) => set('expire', v)}
          />
          <RetentionRow
            checked={fields.engineStreams} onToggle={(v) => set('engineStreams', v)}
            label="Engine streams" hint="Internal routing (prune aggressively)"
            value={fields.engineStreamsExpire} onChange={(v) => set('engineStreamsExpire', v)}
          />
          <RetentionRow
            checked={fields.workerStreams} onToggle={(v) => set('workerStreams', v)}
            label="Worker streams" hint="Activity payloads for execution playback"
            value={fields.workerStreamsExpire} onChange={(v) => set('workerStreamsExpire', v)}
          />
        </div>
      </div>

      {/* Right: cleanup operations */}
      <div className="lg:w-72">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-4">
          Cleanup
        </p>
        <div className="space-y-4">
          <CleanupCheck
            checked={fields.stripAttributes} onChange={(v) => set('stripAttributes', v)}
            label="Strip execution artifacts"
            description="Remove step-level detail from completed jobs. Return data and export history are preserved."
          />
          <CleanupCheck
            checked={fields.pruneTransient} onChange={(v) => set('pruneTransient', v)}
            label="Delete transient jobs"
            description="Orphaned jobs without an entity type. Usually safe to remove."
          />
          <CleanupCallout />
        </div>
      </div>
    </div>
  );
}
