import { IdCard, ScanBarcode } from 'lucide-react';
import { Modal } from '../../common/modal/Modal';
import { UserName } from '../../common/display/UserName';

/**
 * The station write stop-over: editing is open, but a state-changing write owes
 * a fresh badge. Holds the moment and names who to badge as and what the badge
 * will do; the detail page runs the stashed action once a matching badge primes.
 */
export function StationWriteChallenge({
  open,
  verb = 'submit',
  claimantId,
  wrongBadgeName,
  onCancel,
}: {
  open: boolean;
  verb?: string;
  claimantId?: string | null;
  wrongBadgeName?: string | null;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <Modal open onClose={onCancel} title={`Scan your badge to ${verb}`}>
      <div className="flex flex-col items-center text-center py-6" data-testid="station-write-challenge">
        <div className="flex items-center gap-4 mb-6">
          <ScanBarcode className="w-7 h-7 text-text-quaternary" strokeWidth={1} />
          <IdCard className="w-9 h-9 text-accent-muted" strokeWidth={1} />
        </div>
        <p className="text-lg text-text-secondary">
          Scan your badge to {verb} as{' '}
          <span className="font-medium text-text-primary">
            {claimantId ? <UserName userId={claimantId} /> : 'the claimant'}
          </span>.
        </p>
        {wrongBadgeName && (
          <p className="text-sm text-status-error mt-3" data-testid="wrong-badge">
            That badge is {wrongBadgeName}'s — scan the claimant's badge to {verb}.
          </p>
        )}
        <div className="w-16 border-t border-surface-border my-6" />
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-text-tertiary hover:text-text-secondary hover:underline"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}
