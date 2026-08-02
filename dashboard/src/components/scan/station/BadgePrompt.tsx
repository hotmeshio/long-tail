import { useEffect, useRef, useState } from 'react';
import { IdCard, ScanBarcode } from 'lucide-react';
import { Modal } from '../../common/modal/Modal';
import { SimpleMarkdown } from '../../common/display/SimpleMarkdown';
import type { ScanPresentedChoice } from '../../../api/scan-codes';

/**
 * The badge stop-over: a chosen action wants an acting identity that is not
 * primed yet. The screen holds the choice and waits — a badge scan flows
 * through the normal scan pipeline and primes the identity; the moment
 * `primed` flips true this component executes the pending choice (asking
 * first when the choice carries a confirm). Cancel hands control back to the
 * caller, which decides where to return.
 */
export function BadgePrompt({
  choice,
  notPrimedMarkdown,
  primed,
  busy,
  onExecute,
  onCancel,
}: {
  choice: ScanPresentedChoice;
  notPrimedMarkdown?: string;
  primed: boolean;
  busy: boolean;
  onExecute: (choice: ScanPresentedChoice) => void;
  onCancel: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // One execution per priming — re-arms if the grant lapses before it lands.
  const firedRef = useRef(false);

  useEffect(() => {
    if (!primed) {
      firedRef.current = false;
      return;
    }
    if (firedRef.current) return;
    firedRef.current = true;
    if (choice.confirm) setConfirming(true);
    else onExecute(choice);
  }, [primed, choice, onExecute]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center py-24">
      <div className="flex items-center gap-4 mb-8">
        <ScanBarcode className="w-8 h-8 text-text-quaternary" strokeWidth={1} />
        <IdCard className="w-10 h-10 text-accent-muted" strokeWidth={1} />
      </div>
      <h2 className="text-2xl font-light text-text-primary tracking-tight">
        Scan your badge to continue
      </h2>
      <p className="text-lg text-text-secondary mt-2">to {choice.label}</p>
      {notPrimedMarkdown && (
        <div className="text-sm text-text-tertiary mt-6 max-w-prose">
          <SimpleMarkdown content={notPrimedMarkdown} compact />
        </div>
      )}
      <div className="w-16 border-t border-surface-border my-8" />
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="text-sm text-text-tertiary hover:text-text-secondary hover:underline"
      >
        Cancel
      </button>

      {confirming && (
        <Modal open onClose={onCancel} title={choice.label}>
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">{choice.confirm?.prompt}</p>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary text-xs">
                No, go back
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
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
