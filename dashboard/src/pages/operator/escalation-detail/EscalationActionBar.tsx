import { useState } from 'react';
import { Collapsible } from '../../../components/common/Collapsible';
import { CountdownTimer } from '../../../components/common/CountdownTimer';
import { CLAIM_DURATION_OPTIONS } from '../../../lib/constants';

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
    currentRole, escalationTargets, onEscalate, escalatePending, escalateError,
    onRelease, releasePending,
    assignedTo, assignedUntil,
  } = props;

  const [duration, setDuration] = useState('30');
  const [parseError, setParseError] = useState('');
  const [requestTriage, setRequestTriage] = useState(false);
  const [triageNotes, setTriageNotes] = useState('');
  const [escalateTarget, setEscalateTarget] = useState('');

  if (mode === 'terminal') return null;

  const handleSubmitResolve = () => {
    setParseError('');
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(json);
    } catch {
      setParseError('Invalid JSON');
      return;
    }
    if (requestTriage) {
      payload._lt = { needsTriage: true };
      if (triageNotes.trim()) payload.notes = triageNotes.trim();
    }
    onResolve(payload);
  };

  const tabClass = (active: boolean) =>
    `text-xs transition-colors ${active ? 'text-accent font-medium' : 'text-text-tertiary hover:text-accent'}`;

  return (
    <div className="sticky bottom-0 bg-surface/95 backdrop-blur-sm border-t border-surface-border -mx-10 px-10 py-3 z-10" data-testid="escalation-action-bar">

        {/* ── Available: claim ── */}
        {mode === 'available' && (
          <div data-testid="claim-bar">
            {/* Duration tab row */}
            <div className="flex items-center gap-4 mb-2">
              {CLAIM_DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setDuration(opt.value)}
                  className={tabClass(duration === opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {/* Action row — right-aligned */}
            <div className="flex items-center">
              <div className="flex-1" />
              <button
                onClick={() => onClaim(parseInt(duration))}
                disabled={claimPending}
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
              Claimed by <span className="font-mono">{assignedTo}</span>
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
                <div className="space-y-2">
                  <div className="flex items-center gap-4">
                    <label
                      className={`flex items-center gap-2 cursor-pointer px-2.5 py-1 rounded-md transition-colors ${
                        requestTriage
                          ? 'bg-accent/10 text-accent'
                          : 'text-text-tertiary hover:text-text-secondary'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={requestTriage}
                        onChange={(e) => setRequestTriage(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-accent"
                        data-testid="triage-checkbox"
                      />
                      <span className="text-xs font-medium">AI Triage</span>
                    </label>

                    <div className="flex-1" />

                    {parseError && <span className="text-xs text-status-error">{parseError}</span>}
                    {resolveError && <span className="text-xs text-status-error">{resolveError.message}</span>}

                    <button
                      onClick={handleSubmitResolve}
                      disabled={resolvePending}
                      className="btn-primary text-xs"
                    >
                      {resolvePending ? 'Submitting...' : requestTriage ? 'Resolve & Triage' : 'Submit'}
                    </button>
                  </div>

                  <Collapsible open={requestTriage}>
                    <textarea
                      value={triageNotes}
                      onChange={(e) => setTriageNotes(e.target.value)}
                      placeholder="Describe the issue for AI triage..."
                      className="input text-xs w-full"
                      rows={2}
                      data-testid="triage-notes"
                    />
                  </Collapsible>
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
