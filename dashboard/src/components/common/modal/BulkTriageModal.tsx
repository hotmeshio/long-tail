import { useState } from 'react';
import { Modal } from './Modal';

interface BulkTriageModalProps {
  open: boolean;
  onClose: () => void;
  selectedCount: number;
  onSubmit: (hint?: string) => void;
  isPending: boolean;
}

export function BulkTriageModal({
  open,
  onClose,
  selectedCount,
  onSubmit,
  isPending,
}: BulkTriageModalProps) {
  const [hint, setHint] = useState('');

  const handleSubmit = () => {
    onSubmit(hint || undefined);
  };

  return (
    <Modal open={open} onClose={onClose} title="Submit for AI Triage">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Submit <span className="font-medium text-text-primary">{selectedCount}</span> escalation(s)
          for AI triage? The triage orchestrator will take over resolution.
        </p>

        <div>
          <label className="text-xs font-medium text-text-secondary block mb-1">
            Triage hint <span className="text-text-tertiary">(optional)</span>
          </label>
          <input
            type="text"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="e.g., image_orientation"
            className="input text-xs font-mono w-full"
          />
          <p className="text-[10px] text-text-tertiary mt-1">
            Guides the triage workflow on what remediation to apply
          </p>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary text-xs">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="btn-primary text-xs"
          >
            {isPending ? 'Submitting...' : 'Submit for Triage'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
