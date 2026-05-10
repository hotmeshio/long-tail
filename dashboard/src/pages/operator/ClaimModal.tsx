import { Modal } from '../../components/common/modal/Modal';
import { CustomDurationPicker } from '../../components/common/form/CustomDurationPicker';
import type { LTEscalationRecord } from '../../api/types';

interface ClaimModalProps {
  claimTarget: LTEscalationRecord | null;
  onClose: () => void;
  claimDuration: string;
  onDurationChange: (value: string) => void;
  claimDurations: Array<{ value: string; label: string }>;
  customClaimMinutes: number;
  onCustomClaimChange: (minutes: number) => void;
  onClaim: () => void;
  isPending: boolean;
}

export function ClaimModal({
  claimTarget,
  onClose,
  claimDuration,
  onDurationChange,
  claimDurations,
  onCustomClaimChange,
  onClaim,
  isPending,
}: ClaimModalProps) {
  return (
    <Modal
      open={!!claimTarget}
      onClose={onClose}
      title="Claim Escalation"
    >
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Claim <span className="font-medium text-text-primary">{claimTarget?.type}</span> for:
        </p>
        <select
          value={claimDuration}
          onChange={(e) => { onDurationChange(e.target.value); }}
          className="select w-full text-sm"
        >
          {claimDurations.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
          <option value="custom">Other...</option>
        </select>
        {claimDuration === 'custom' && (
          <CustomDurationPicker onChange={onCustomClaimChange} autoFocus />
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary text-xs">
            Cancel
          </button>
          <button
            onClick={onClaim}
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
