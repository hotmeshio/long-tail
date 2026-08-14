import { useState, useCallback } from 'react';
import { buildResolverPayload } from '../../../lib/resolver-payload';
import { CountdownTimer } from '../../../components/common/display/CountdownTimer';
import { UserName } from '../../../components/common/display/UserName';
import { CustomDurationPicker } from '../../../components/common/form/CustomDurationPicker';
import { useClaimDurations } from '../../../hooks/useClaimDurations';
import type { EscalationActionBarProps } from './action-bar-types';

export type { ActionBarMode, ActiveView, EscalationActionBarProps } from './action-bar-types';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EscalationActionBar(props: EscalationActionBarProps) {
  const {
    mode, activeView, onActiveViewChange,
    onClaim, claimPending, claimNudge,
    workflowType, json, onResolve, resolvePending, resolveError,
    requestTriage, triageNotes,
    onRelease, releasePending,
    onCancel,
    assignedTo, assignedUntil,
    onSubmitAttempt,
    onValidationErrors,
    escalationContext,
    labels = {},
    submitBlocked,
    submitBlockedMessage,
    actingName,
    badgePrompt,
  } = props;

  const claimDurations = useClaimDurations();
  const [duration, setDuration] = useState('30');
  const [customMinutes, setCustomMinutes] = useState(0);
  const [parseError, setParseError] = useState('');

  const isCustom = duration === 'custom';
  const onCustomChange = useCallback((m: number) => setCustomMinutes(m), []);

  // x-lt-submit-guard is owned by the page (it drives auto-resolve too); the bar
  // just reflects its block state. The gate applies to the form resolve only —
  // triage stays the escape hatch when the guarded work itself is the problem.
  const guardBlocksSubmit = !!submitBlocked && !requestTriage;

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

    // Parse, validate against the embedded _form_schema, and map to the final
    // nested shape — the same pass the API layer runs on enforced roles, so the
    // panel and a server 422 report the identical list. Hidden fields (x-lt-showIf
    // falsy against the live context) are excluded from the required checks.
    const result = buildResolverPayload(json, escalationContext);
    if (result.parseError) {
      setParseError(result.parseError);
      return;
    }
    if (result.errors.length > 0) {
      // Field errors live in ONE surface: the errors panel, which opens on the
      // blocked submit and recomputes as the user fixes fields. A summary here
      // would go stale the moment a field is corrected — the footer keeps only
      // its own errors (bad JSON, server rejection).
      onSubmitAttempt?.();
      onValidationErrors?.(result.errors);
      return;
    }
    onResolve(result.payload!);
  };

  const tabClass = (active: boolean) =>
    `text-xs transition-colors ${active ? 'text-accent font-medium' : 'text-text-tertiary hover:text-accent'}`;

  return (
    // Flex-pinned at the bottom of the form column: full-bleed left into the
    // page gutter, ending at the side panel's edge on the right.
    <div className="shrink-0 h-[80px] bg-surface/95 backdrop-blur-sm border-t border-surface-border -ml-10 pl-10 pr-10 pt-3 pb-5" data-testid="escalation-action-bar">

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
              {labels.cancel !== false && (
                <button
                  onClick={onCancel}
                  className="text-xs text-text-tertiary hover:text-status-error transition-colors"
                >
                  {labels.cancel ?? 'Cancel escalation'}
                </button>
              )}
              <div className="flex-1" />
              {isCustom && (
                <CustomDurationPicker onChange={onCustomChange} compact autoFocus />
              )}
              <button
                // Keyed by the nudge count: each locked-form click remounts
                // the button, restarting the wiggle from the top.
                key={claimNudge}
                onClick={handleClaim}
                disabled={claimPending || (isCustom && customMinutes <= 0)}
                className={`btn-primary text-xs ${claimNudge ? 'animate-[field-shake_0.4s_ease-in-out]' : ''}`}
                data-testid="claim-button"
              >
                {claimPending ? 'Claiming...' : (labels.claim ?? 'Claim')}
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
            {/* An expired badge grant on submit lands here: the acting state
                cleared, the server's answer surfaces, and a fresh scan retries. */}
            {resolveError && <span className="text-xs text-status-error">{resolveError.message}</span>}
            {badgePrompt && (
              <p className="text-xs text-text-tertiary" data-testid="badge-prompt">
                If this is your claim, scan your badge.
              </p>
            )}
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
              <button
                onClick={() => onActiveViewChange('release')}
                className={`text-xs transition-colors ${activeView === 'release' ? 'text-status-error font-medium' : 'text-text-tertiary hover:text-status-error'}`}
              >
                {labels.release ?? 'Release'}
              </button>
              {labels.cancel !== false && (
                <button
                  onClick={onCancel}
                  className="text-xs transition-colors text-text-tertiary hover:text-status-error"
                >
                  {labels.cancel ?? 'Cancel'}
                </button>
              )}
            </div>

            {/* ── Resolve controls ── */}
            {activeView === 'resolve' && (
              <div className="flex items-center gap-4">
                {/* The badged person's claim: name the identity the submit acts as. */}
                {actingName && (
                  <p className="text-sm text-text-secondary" data-testid="acting-claim-note">
                    Claimed by you <span className="font-medium text-text-primary">({actingName})</span>
                  </p>
                )}
                {actingName && assignedUntil && <CountdownTimer until={assignedUntil} />}
                <div className="flex-1" />
                {parseError && <span className="text-xs text-status-error">{parseError}</span>}
                {resolveError && <span className="text-xs text-status-error">{resolveError.message}</span>}
                {guardBlocksSubmit && submitBlockedMessage && (
                  <span className="text-xs text-status-pending" data-testid="submit-guard-message">
                    {submitBlockedMessage}
                  </span>
                )}
                <button
                  onClick={handleSubmitResolve}
                  disabled={resolvePending || guardBlocksSubmit}
                  className="btn-primary text-xs"
                >
                  {resolvePending
                    ? (workflowType ? 'Submitting...' : 'Acknowledging...')
                    : requestTriage ? 'Send to Triage'
                    : (labels.submit ?? (workflowType ? 'Submit' : 'Acknowledge'))}
                </button>
              </div>
            )}

            {/* ── Release controls ── */}
            {activeView === 'release' && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-text-secondary">Release back to pool?</span>
                <div className="flex-1" />
                <button onClick={() => onActiveViewChange('resolve')} className="btn-secondary text-xs">
                  Back
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
