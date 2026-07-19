import { useState, useCallback } from 'react';
import { Modal } from '../../../components/common/modal/Modal';
import { CustomDurationPicker } from '../../../components/common/form/CustomDurationPicker';
import { CountdownTimer } from '../../../components/common/display/CountdownTimer';
import { useClaimDurations } from '../../../hooks/useClaimDurations';

interface ClaimExpiryModalProps {
  open: boolean;
  /** ISO timestamp the claim expires at — drives the live countdown. */
  assignedUntil: string;
  onClose: () => void;
  onExtend: (durationMinutes: number) => void;
  isPending: boolean;
}

/**
 * Shown when the user's claim enters the warning window before expiry.
 * Extending re-claims with a fresh duration (an idempotent TTL extension for
 * the same assignee). Dismissing lets the claim lapse — the form locks at
 * expiry and edits are kept as a local draft.
 */
export function ClaimExpiryModal({ open, assignedUntil, onClose, onExtend, isPending }: ClaimExpiryModalProps) {
  const claimDurations = useClaimDurations();
  const [claimDuration, setClaimDuration] = useState('30');
  const [customMinutes, setCustomMinutes] = useState(0);

  const isCustom = claimDuration === 'custom';
  const effectiveMinutes = isCustom ? customMinutes : parseInt(claimDuration);
  const onCustomChange = useCallback((m: number) => setCustomMinutes(m), []);

  return (
    <Modal open={open} onClose={onClose} title="Claim Expiring">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Your claim on this escalation expires in{' '}
          <CountdownTimer until={assignedUntil} />. When it lapses, the form
          locks and the item returns to the queue — your edits are kept as a
          draft. Extend to keep working.
        </p>
        <select
          value={claimDuration}
          onChange={(e) => { setClaimDuration(e.target.value); setCustomMinutes(0); }}
          className="select w-full text-sm"
          aria-label="Extension duration"
        >
          {claimDurations.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
          <option value="custom">Other...</option>
        </select>
        {isCustom && (
          <CustomDurationPicker onChange={onCustomChange} autoFocus />
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary text-xs">
            Dismiss
          </button>
          <button
            onClick={() => onExtend(effectiveMinutes)}
            className="btn-primary text-xs"
            disabled={isPending || !effectiveMinutes || effectiveMinutes <= 0}
          >
            {isPending ? 'Extending...' : 'Extend Claim'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
