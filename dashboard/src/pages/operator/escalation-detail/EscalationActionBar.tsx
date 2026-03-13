import { useState, useCallback } from 'react';
import { CountdownTimer } from '../../../components/common/CountdownTimer';
import { UserName } from '../../../components/common/UserName';
import { CustomDurationPicker } from '../../../components/common/CustomDurationPicker';
import { useClaimDurations } from '../../../hooks/useClaimDurations';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionBarMode =
  | 'available'       // unclaimed — show claim controls
  | 'claimed_by_me'   // I own it — show resolve/escalate/release
  | 'claimed_by_other'// someone else has it
  | 'terminal';       // resolved or cancelled — nothing to do

export type ActiveView = 'resolve' | 'escalate' | 'release';

export interface EscalationActionBarProps {
  mode: ActionBarMode;
  // Active view (controlled by parent)
  activeView: ActiveView;
  onActiveViewChange: (view: ActiveView) => void;
  // Claim
  onClaim: (minutes: number) => void;
  claimPending: boolean;
  // Resolve — JSON lives in viewport, bar reads it for submit
  workflowType: string | null;
  json: string;
  onResolve: (payload: Record<string, unknown>) => void;
  resolvePending: boolean;
  resolveError: Error | null;
  // Triage (controlled by parent — callout + overlay render in page body)
  requestTriage: boolean;
  triageNotes: string;
  // Escalate
  currentRole: string;
  escalationTargets: string[];
  onEscalate: (role: string) => void;
  escalatePending: boolean;
  escalateError: Error | null;
  // Release
  onRelease: () => void;
  releasePending: boolean;
  // Other user
  assignedTo?: string | null;
  assignedUntil?: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EscalationActionBar(props: EscalationActionBarProps) {
  const {
    mode, activeView, onActiveViewChange,
    onClaim, claimPending,
    workflowType, json, onResolve, resolvePending, resolveError,
    requestTriage, triageNotes,
    currentRole, escalationTargets, onEscalate, escalatePending, escalateError,
    onRelease, releasePending,
    assignedTo, assignedUntil,
  } = props;

  const claimDurations = useClaimDurations();
  const [duration, setDuration] = useState('30');
  const [customMinutes, setCustomMinutes] = useState(0);
  const [parseError, setParseError] = useState('');
  const [escalateTarget, setEscalateTarget] = useState('');

  const isCustom = duration === 'custom';
  const onCustomChange = useCallback((m: number) => setCustomMinutes(m), []);

  if (mode === 'terminal') return null;

  const handleClaim = () => {
    const minutes = isCustom ? customMinutes : parseInt(duration);
    if (!minutes || minutes <= 0) return;
    onClaim(minutes);
  };

  const handleSubmitResolve = () => {
    setParseError('');

    // When triage is requested, ignore the form payload entirely.
    // Only the triage flag and notes matter — the form data (e.g.
    // approved: true) must NOT leak through, as it would confuse
    // the triage workflow into thinking the issue is already resolved.
    if (requestTriage) {
      const payload: Record<string, unknown> = {
        _lt: { needsTriage: true },
      };
      if (triageNotes.trim()) payload.notes = triageNotes.trim();
      onResolve(payload);
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(json);
    } catch {
      setParseError('Invalid JSON');
      return;
    }
    onResolve(payload);
  };

  const tabClass = (active: boolean) =>
    `text-xs transition-colors ${active ? 'text-accent font-medium' : 'text-text-tertiary hover:text-accent'}`;

  return (
    <div className="sticky bottom-0 h-[72px] bg-surface/95 backdrop-blur-sm border-t border-surface-border -mx-10 px-10 py-3 z-10" data-testid="escalation-action-bar">

        {/* ── Available: claim ── */}
        {mode === 'available' && (
          <div data-testid="claim-bar">
            {/* Duration tab row */}
            <div className="flex items-center gap-4 mb-2">
              {claimDurations.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setDuration(opt.value); setCustomMinutes(0); }}
                  className={tabClass(!isCustom && duration === opt.value)}
                >
                  {opt.label}
                </button>
              ))}
              <button
                onClick={() => setDuration('custom')}
                className={tabClass(isCustom)}
              >
                Other
              </button>
            </div>
            {/* Action row — right-aligned */}
            <div className="flex items-center gap-3">
              <div className="flex-1" />
              {isCustom && (
                <CustomDurationPicker onChange={onCustomChange} compact autoFocus />
              )}
              <button
                onClick={handleClaim}
                disabled={claimPending || (isCustom && customMinutes <= 0)}
                className="btn-primary text-xs"
              >
                {claimPending ? 'Claiming...' : 'Claim'}
              </button>
            </div>
          </div>
        )}

        {/* ── Claimed by other ── */}
        {mode === 'claimed_by_other' && (
          <div className="flex items-center gap-4" data-testid="claimed-other-bar">
            <p className="text-sm text-text-secondary">
              Claimed by <span className="font-medium text-text-primary">{assignedTo ? <UserName userId={assignedTo} /> : 'unknown'}</span>
            </p>
            {assignedUntil && <CountdownTimer until={assignedUntil} />}
          </div>
        )}

        {/* ── Claimed by me ── */}
        {mode === 'claimed_by_me' && (
          <div data-testid="action-bar">
            {/* Tab row */}
            <div className="flex items-center gap-4 mb-2">
              <button
                onClick={() => onActiveViewChange('resolve')}
                className={tabClass(activeView === 'resolve')}
              >
                {workflowType ? 'Resolve' : 'Acknowledge'}
              </button>
              {escalationTargets.length > 0 && (
                <button
                  onClick={() => onActiveViewChange('escalate')}
                  className={tabClass(activeView === 'escalate')}
                >
                  Escalate
                </button>
              )}
              <button
                onClick={() => onActiveViewChange('release')}
                className={`text-xs transition-colors ${activeView === 'release' ? 'text-status-error font-medium' : 'text-text-tertiary hover:text-status-error'}`}
              >
                Release
              </button>
            </div>

            {/* ── Resolve controls ── */}
            {activeView === 'resolve' && (
              workflowType ? (
                <div className="flex items-center gap-4">
                  <div className="flex-1" />

                  {parseError && <span className="text-xs text-status-error">{parseError}</span>}
                  {resolveError && <span className="text-xs text-status-error">{resolveError.message}</span>}

                  <button
                    onClick={handleSubmitResolve}
                    disabled={resolvePending}
                    className="btn-primary text-xs"
                  >
                    {resolvePending ? 'Submitting...' : requestTriage ? 'Send to Triage' : 'Submit'}
                  </button>
                </div>
              ) : (
                <div className="flex items-center">
                  <span className="text-xs text-text-secondary">Notification — acknowledge to resolve</span>
                  <div className="flex-1" />
                  {resolveError && <span className="text-xs text-status-error mr-3">{resolveError.message}</span>}
                  <button
                    onClick={() => onResolve({ acknowledged: true })}
                    disabled={resolvePending}
                    className="btn-primary text-xs"
                  >
                    {resolvePending ? 'Acknowledging...' : 'Acknowledge'}
                  </button>
                </div>
              )
            )}

            {/* ── Escalate controls ── */}
            {activeView === 'escalate' && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-text-secondary">
                  From <span className="font-medium text-text-primary">{currentRole}</span> to
                </span>
                <select
                  value={escalateTarget}
                  onChange={(e) => setEscalateTarget(e.target.value)}
                  className="select text-xs"
                  data-testid="escalate-select"
                >
                  <option value="">Select role...</option>
                  {escalationTargets.map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
                <div className="flex-1" />
                {escalateError && <span className="text-xs text-status-error">{escalateError.message}</span>}
                <button
                  onClick={() => onEscalate(escalateTarget)}
                  disabled={!escalateTarget || escalatePending}
                  className="btn-primary text-xs"
                >
                  {escalatePending ? 'Escalating...' : 'Escalate'}
                </button>
              </div>
            )}

            {/* ── Release controls ── */}
            {activeView === 'release' && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-text-secondary">Release back to pool?</span>
                <div className="flex-1" />
                <button onClick={() => onActiveViewChange('resolve')} className="btn-secondary text-xs">
                  Cancel
                </button>
                <button
                  onClick={onRelease}
                  disabled={releasePending}
                  className="btn-primary text-xs bg-status-error hover:bg-status-error/80"
                >
                  {releasePending ? 'Releasing...' : 'Yes, Release'}
                </button>
              </div>
            )}
          </div>
        )}
    </div>
  );
}
