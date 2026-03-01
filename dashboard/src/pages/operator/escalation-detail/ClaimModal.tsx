import { useState } from 'react';
import { Modal } from '../../../components/common/Modal';
import { CLAIM_DURATION_OPTIONS } from '../../../lib/constants';

interface ClaimModalProps {
  open: boolean;
  onClose: () => void;
  onClaim: (durationMinutes: number) => void;
  isPending: boolean;
}

export function ClaimModal({ open, onClose, onClaim, isPending }: ClaimModalProps) {
  const [claimDuration, setClaimDuration] = useState('30');

  return (
    <Modal open={open} onClose={onClose} title="Claim Escalation">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          How long do you need?
        </p>
        <select
          value={claimDuration}
          onChange={(e) => setClaimDuration(e.target.value)}
          className="select w-full text-sm"
        >
          {CLAIM_DURATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary text-xs">
            Cancel
          </button>
          <button
            onClick={() => onClaim(parseInt(claimDuration))}
            className="btn-primary text-xs"
            disabled={isPending}
          >
            {isPending ? 'Claiming...' : 'Claim'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
