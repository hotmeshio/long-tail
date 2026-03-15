import { useState, useCallback } from 'react';
import { Modal } from '../../../components/common/modal/Modal';
import { CustomDurationPicker } from '../../../components/common/form/CustomDurationPicker';
import { useClaimDurations } from '../../../hooks/useClaimDurations';

interface ClaimModalProps {
  open: boolean;
  onClose: () => void;
  onClaim: (durationMinutes: number) => void;
  isPending: boolean;
}

export function ClaimModal({ open, onClose, onClaim, isPending }: ClaimModalProps) {
  const claimDurations = useClaimDurations();
  const [claimDuration, setClaimDuration] = useState('30');
  const [customMinutes, setCustomMinutes] = useState(0);

  const isCustom = claimDuration === 'custom';
  const effectiveMinutes = isCustom ? customMinutes : parseInt(claimDuration);
  const onCustomChange = useCallback((m: number) => setCustomMinutes(m), []);

  return (
    <Modal open={open} onClose={onClose} title="Claim Escalation">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          How long do you need?
        </p>
        <select
          value={claimDuration}
          onChange={(e) => { setClaimDuration(e.target.value); setCustomMinutes(0); }}
          className="select w-full text-sm"
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
            Cancel
          </button>
          <button
            onClick={() => onClaim(effectiveMinutes)}
            className="btn-primary text-xs"
            disabled={isPending || !effectiveMinutes || effectiveMinutes <= 0}
          >
            {isPending ? 'Claiming...' : 'Claim'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
