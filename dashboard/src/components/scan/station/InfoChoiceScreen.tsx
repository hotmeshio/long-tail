import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../common/modal/Modal';
import { SimpleMarkdown } from '../../common/display/SimpleMarkdown';
import { useScanInput } from '../../../hooks/useScanInput';
import { formatTimeAgo } from '../../../lib/format';
import { isChoiceEnabled, matchChoiceByCode } from './choice-code';
import type { ScanExecuteResponse, ScanPresentedChoice } from '../../../api/scan-codes';

function RealityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-4 py-2">
      <span className="w-32 shrink-0 text-xs uppercase tracking-wide text-text-tertiary">{label}</span>
      <span className="text-sm text-text-primary break-all">{value}</span>
    </div>
  );
}

/**
 * A PRESENT response, rendered whole. Upper half states the located item's
 * reality plainly; lower half offers the step's labeled choices as large
 * buttons. Withheld choices show the badge affordance and enable fully the
 * moment an acting identity primes. While mounted, this screen
 * takes first look at raw scans: a code matching an enabled choice selects it
 * (confirm still applies); everything else falls through to normal execution.
 * Tapping a withheld choice hands it to the caller as a pending action — the
 * badge stop-over collects the identity and executes it.
 */
export function InfoChoiceScreen({
  response,
  hasActingIdentity,
  selfId,
  busy,
  onExecute,
  onWithheldSelect,
}: {
  response: ScanExecuteResponse;
  hasActingIdentity: boolean;
  selfId: string | null;
  busy: boolean;
  onExecute: (choice: ScanPresentedChoice) => void;
  onWithheldSelect: (choice: ScanPresentedChoice) => void;
}) {
  const { setCodeInterceptor } = useScanInput();
  const [pendingChoice, setPendingChoice] = useState<ScanPresentedChoice | null>(null);

  const escalation = (response.escalation ?? {}) as Record<string, unknown>;
  const choices = response.choices ?? [];
  const metadata = (escalation.metadata ?? {}) as Record<string, unknown>;

  const select = (choice: ScanPresentedChoice) => {
    if (choice.confirm) setPendingChoice(choice);
    else onExecute(choice);
  };

  // Live refs so the interceptor installed once sees current state — a badge
  // primed after mount enables withheld choices for double-scan selection too.
  const liveRef = useRef({ choices, hasActingIdentity, select });
  liveRef.current = { choices, hasActingIdentity, select };

  useEffect(() => {
    setCodeInterceptor((raw) => {
      const live = liveRef.current;
      const match = matchChoiceByCode(live.choices, live.hasActingIdentity, raw);
      if (!match) return false;
      live.select(match);
      return true;
    });
    return () => setCodeInterceptor(null);
  }, [setCodeInterceptor]);

  const assignedTo = (escalation.assigned_to as string | null) ?? null;
  const claimState = !assignedTo ? 'Unclaimed' : assignedTo === selfId ? 'Claimed by you' : 'Claimed';
  const typeLine = [escalation.type, escalation.subtype].filter(Boolean).join(' · ');

  return (
    <div className="flex-1 min-h-0 flex flex-col max-w-form">
      {/* Reality — stated plainly */}
      <div>
        {response.rule?.name && (
          <div className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-2">
            {response.rule.name}
          </div>
        )}
        <h2 className="text-xl text-text-primary mb-4">
          {(escalation.description as string) || typeLine || 'Located item'}
        </h2>
        <div className="divide-y divide-surface-border border-y border-surface-border">
          <RealityRow label="Queue" value={String(escalation.role ?? '—')} />
          {typeLine && <RealityRow label="Type" value={typeLine} />}
          <RealityRow label="Claim" value={claimState} />
          {typeof escalation.created_at === 'string' && (
            <RealityRow label="Age" value={formatTimeAgo(escalation.created_at)} />
          )}
          {Object.entries(metadata).map(([key, value]) => (
            <RealityRow key={key} label={key} value={String(value)} />
          ))}
        </div>
      </div>

      {/* Choices — the human's tap (or a second scan) disambiguates */}
      <div className="mt-8 space-y-3">
        {choices.map((choice) => {
          const enabled = isChoiceEnabled(choice, hasActingIdentity);
          return (
            <div key={choice.index}>
              <button
                type="button"
                disabled={busy}
                onClick={() => (enabled ? select(choice) : onWithheldSelect(choice))}
                className={`w-full text-left px-5 py-4 text-lg border border-surface-border rounded hover:bg-surface-sunken transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${enabled ? 'text-text-primary' : 'text-text-secondary'}`}
              >
                <span className="flex items-baseline gap-3">
                  {choice.label}
                  {choice.code && (
                    <span className="ml-auto text-2xs font-mono text-text-quaternary">{choice.code}</span>
                  )}
                </span>
              </button>
              {!enabled && (
                <div className="text-xs text-status-warning mt-1.5 px-1">
                  {response.notPrimed?.markdown ? (
                    <SimpleMarkdown content={response.notPrimed.markdown} compact />
                  ) : (
                    <>Scan your badge to {choice.label.toLowerCase()}</>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pendingChoice && (
        <Modal open onClose={() => setPendingChoice(null)} title={pendingChoice.label}>
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">{pendingChoice.confirm?.prompt}</p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPendingChoice(null)}
                disabled={busy}
                className="btn-secondary text-xs"
              >
                No, go back
              </button>
              <button
                type="button"
                onClick={() => {
                  const choice = pendingChoice;
                  setPendingChoice(null);
                  onExecute(choice);
                }}
                disabled={busy}
                className="btn-primary text-xs"
              >
                Yes, continue
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
