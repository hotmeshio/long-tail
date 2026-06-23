import { PRIORITY_OPTIONS } from '../../../lib/constants';
import { useClaimDurations } from '../../../hooks/useClaimDurations';

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

export function BulkActionBar(props: BulkActionBarProps) {
  const disabled = anyPending(props);
  const claimDurations = useClaimDurations();

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-accent/5 border border-accent/20 rounded-lg mb-4">
      <span className="text-xs font-medium text-accent">
        {props.selectedCount} selected
      </span>

      <div className="w-px h-5 bg-surface-border" />

      {/* Priority */}
      <select
        onChange={(e) => {
          if (!e.target.value) return;
          props.onSetPriority(parseInt(e.target.value) as 1 | 2 | 3 | 4);
          e.target.value = '';
        }}
        disabled={disabled}
        className="select text-xs py-1.5"
        defaultValue=""
      >
        <option value="" disabled>Priority...</option>
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
        className="select text-xs py-1.5"
        defaultValue=""
      >
        <option value="" disabled>Claim for...</option>
        {claimDurations.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Assign */}
      <button
        onClick={props.onAssign}
        disabled={disabled}
        className="btn-secondary text-xs py-1.5"
      >
        {props.isAssignPending ? 'Assigning...' : 'Assign to...'}
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
          className="select text-xs py-1.5"
          defaultValue=""
        >
          <option value="" disabled>Escalate to...</option>
          {props.availableRoles.map((role) => (
            <option key={role} value={role}>{role}</option>
          ))}
        </select>
      )}

      {/* Triage */}
      <button
        onClick={props.onTriage}
        disabled={disabled}
        className="btn-secondary text-xs py-1.5"
      >
        {props.isTriagePending ? 'Triaging...' : 'Triage'}
      </button>

      {/* Cancel */}
      <button
        onClick={props.onCancel}
        disabled={disabled}
        className="text-xs py-1.5 px-3 rounded-md border border-status-error/40 text-status-error hover:bg-status-error/10 transition-colors disabled:opacity-50"
      >
        {props.isCancelPending ? 'Cancelling...' : 'Cancel'}
      </button>

      <div className="flex-1" />

      {/* Clear */}
      <button
        onClick={props.onClearSelection}
        className="text-xs text-text-tertiary hover:text-text-primary transition-colors"
      >
        Clear
      </button>

      {disabled && (
        <span className="text-xs text-text-tertiary animate-pulse">Processing...</span>
      )}
    </div>
  );
}
