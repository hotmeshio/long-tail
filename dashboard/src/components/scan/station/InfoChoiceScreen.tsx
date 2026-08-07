import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../common/modal/Modal';
import { useScanInput } from '../../../hooks/useScanInput';
import { formatTimeAgo } from '../../../lib/format';
import { isChoiceEnabled, matchChoiceByCode } from './choice-code';
import type { ScanExecuteResponse, ScanPresentedChoice } from '../../../api/scan-codes';

/** Format a metadata leaf for display: booleans read as Yes/No, objects compact
 *  to JSON, empty values show an em dash. */
function formatFactValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-4 py-2">
      <span className="w-32 shrink-0 text-2xs uppercase tracking-wide text-text-quaternary">{label}</span>
      <span className="text-sm text-text-primary break-words">{value}</span>
    </div>
  );
}

/** Inline dot separator for the dense summary line. */
function Dot() {
  return <span className="text-text-quaternary select-none">·</span>;
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
  const claimClass = assignedTo === selfId ? 'text-accent' : 'text-text-secondary';
  const typeLine = [escalation.type, escalation.subtype].filter(Boolean).join(' · ');
  const metaEntries = Object.entries(metadata);

  return (
    <div className="flex-1 min-h-0 flex flex-col max-w-form">
      {/* Reality — the located item's identity up top, dense summary beneath,
          then its metadata as a clean definition list. */}
      <div>
        {response.rule?.name && (
          <div className="text-2xs font-semibold uppercase tracking-widest text-accent mb-2">
            {response.rule.name}
          </div>
        )}
        <h2 className="text-2xl font-medium leading-tight text-text-primary mb-2">
          {(escalation.description as string) || typeLine || 'Located item'}
        </h2>
        {/* Dense one-line summary of the system facts. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary mb-5">
          <span>{String(escalation.role ?? '—')}</span>
          {typeLine && (<><Dot /><span>{typeLine}</span></>)}
          <Dot /><span className={claimClass}>{claimState}</span>
          {typeof escalation.created_at === 'string' && (
            <><Dot /><span>{formatTimeAgo(escalation.created_at)}</span></>
          )}
        </div>
        {metaEntries.length > 0 && (
          <div className="divide-y divide-surface-border border-t border-surface-border">
            {metaEntries.map(([key, value]) => (
              <FactRow key={key} label={key} value={formatFactValue(value)} />
            ))}
          </div>
        )}
      </div>

      {/* Choices — the human's tap (or a second scan) disambiguates */}
      <div className="mt-8 space-y-3">
        {choices.map((choice) => {
          const enabled = isChoiceEnabled(choice, hasActingIdentity);
          // Withheld choices stay fully presented and tappable — the identity
          // requirement is collected on the ensuing badge screen, not announced
          // here (one instruction at a time keeps this screen clear).
          return (
            <div key={choice.index}>
              <button
                type="button"
                disabled={busy}
                onClick={() => (enabled ? select(choice) : onWithheldSelect(choice))}
                className="w-full text-left px-5 py-4 text-lg text-text-primary border border-surface-border rounded hover:bg-surface-sunken transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="flex items-baseline gap-3">
                  {choice.label}
                  {choice.code && (
                    <span className="ml-auto text-2xs font-mono text-text-quaternary">{choice.code}</span>
                  )}
                </span>
              </button>
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
