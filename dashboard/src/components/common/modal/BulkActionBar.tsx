import { PRIORITY_OPTIONS } from '../../../lib/constants';
import { useClaimDurations } from '../../../hooks/useClaimDurations';
import { useSettings } from '../../../api/settings';
import { getAiOverride } from '../../../lib/view-as';

interface BulkActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onSetPriority: (priority: 1 | 2 | 3 | 4) => void;
  onClaim: (durationMinutes: number) => void;
  onAssign: () => void;
  onEscalate: (targetRole: string) => void;
  onTriage: () => void;
  onCancel: () => void;
  isPriorityPending: boolean;
  isClaimPending: boolean;
  isAssignPending: boolean;
  isEscalatePending: boolean;
  isTriagePending: boolean;
  isCancelPending: boolean;
  availableRoles: string[];
}

const anyPending = (props: BulkActionBarProps) =>
  props.isPriorityPending || props.isClaimPending || props.isAssignPending || props.isEscalatePending || props.isTriagePending || props.isCancelPending;

// One control chrome for the whole bar — white pill-free buttons on the band,
// hairline border, a barely-there 3px radius (square reads timeless, not dated),
// definition on hover. Selects share it so the toolbar is one cohesive set.
const CTRL =
  'inline-flex items-center h-7 px-2.5 text-2xs font-medium text-text-secondary bg-surface border border-surface-border rounded-[4px] hover:border-accent/50 hover:text-text-primary transition-colors disabled:opacity-50 disabled:hover:border-surface-border';
const SELECT = `${CTRL} appearance-none cursor-pointer`;
const DANGER =
  'inline-flex items-center h-7 px-2.5 text-2xs font-medium text-status-error bg-surface border border-status-error/30 rounded-[4px] hover:border-status-error hover:bg-status-error/5 transition-colors disabled:opacity-50';

export function BulkActionBar(props: BulkActionBarProps) {
  const disabled = anyPending(props);
  const claimDurations = useClaimDurations();
  // Triage is an LLM action. `useSettings().ai.enabled` is the single source of
  // truth — it merges the server /settings flag with the persisted localStorage
  // override (lt_ai_override). Hide the button entirely when AI is off.
  const { data: settings } = useSettings();
  const aiOverride = getAiOverride();
  const aiEnabled = aiOverride !== null ? aiOverride : settings?.ai?.enabled === true;
  const open = props.selectedCount > 0;

  return (
    // Animated reveal — grows and opacity-fades in/out with ease-in-out as the
    // selection changes. Always mounted so it can animate on exit, not just enter.
    <div
      className={`grid transition-all duration-200 ease-in-out ${
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
      }`}
    >
      <div className="overflow-hidden">
        {/* Contextual band: neutral fill + a 2px accent left rule anchors it as a
            distinct "selection mode" surface without a rounded card. */}
        <div className="flex flex-wrap items-center gap-2 py-2.5 pl-3 pr-2 mt-4 mb-3 bg-surface-sunken/60 border-l-2 border-l-accent">
      <span className="text-2xs font-semibold uppercase tracking-wider text-accent tabular-nums">
        {props.selectedCount} selected
      </span>

      <div className="mx-1 h-4 w-px bg-surface-border" />

      {/* Priority */}
      <select
        onChange={(e) => {
          if (!e.target.value) return;
          props.onSetPriority(parseInt(e.target.value) as 1 | 2 | 3 | 4);
          e.target.value = '';
        }}
        disabled={disabled}
        className={SELECT}
        defaultValue=""
      >
        <option value="" disabled>Priority…</option>
        {PRIORITY_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Claim */}
      <select
        onChange={(e) => {
          if (!e.target.value) return;
          props.onClaim(parseInt(e.target.value));
          e.target.value = '';
        }}
        disabled={disabled}
        className={SELECT}
        defaultValue=""
      >
        <option value="" disabled>Claim for…</option>
        {claimDurations.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Assign */}
      <button onClick={props.onAssign} disabled={disabled} className={CTRL}>
        {props.isAssignPending ? 'Assigning…' : 'Assign to…'}
      </button>

      {/* Escalate */}
      {props.availableRoles.length > 0 && (
        <select
          onChange={(e) => {
            if (!e.target.value) return;
            props.onEscalate(e.target.value);
            e.target.value = '';
          }}
          disabled={disabled}
          className={SELECT}
          defaultValue=""
        >
          <option value="" disabled>Escalate to…</option>
          {props.availableRoles.map((role) => (
            <option key={role} value={role}>{role}</option>
          ))}
        </select>
      )}

      {/* Triage — LLM-powered, shown only when AI is enabled */}
      {aiEnabled && (
        <button onClick={props.onTriage} disabled={disabled} className={CTRL}>
          {props.isTriagePending ? 'Triaging…' : 'Triage'}
        </button>
      )}

      {/* Cancel */}
      <button onClick={props.onCancel} disabled={disabled} className={DANGER}>
        {props.isCancelPending ? 'Cancelling…' : 'Cancel'}
      </button>

      <div className="flex-1" />

      {disabled && (
        <span className="text-2xs text-text-tertiary animate-pulse">Processing…</span>
      )}

      {/* Clear */}
      <button
        onClick={props.onClearSelection}
        className="px-1 text-2xs font-medium text-text-tertiary hover:text-text-primary transition-colors"
      >
        Clear
      </button>
        </div>
      </div>
    </div>
  );
}
