import { useState } from 'react';
import { Modal } from '../../../components/common/Modal';

interface EscalateModalProps {
  open: boolean;
  onClose: () => void;
  currentRole: string;
  targets: string[];
  onEscalate: (targetRole: string) => void;
  isPending: boolean;
  error?: Error | null;
}

export function EscalateModal({ open, onClose, currentRole, targets, onEscalate, isPending, error }: EscalateModalProps) {
  const [selectedTargetRole, setSelectedTargetRole] = useState('');

  return (
    <Modal open={open} onClose={onClose} title="Escalate to Role">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Reassign this escalation from{' '}
          <span className="font-medium text-text-primary">{currentRole}</span> to:
        </p>
        <select
          value={selectedTargetRole}
          onChange={(e) => setSelectedTargetRole(e.target.value)}
          className="select w-full text-sm"
        >
          <option value="">Select a role...</option>
          {targets.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        {error && (
          <p className="text-xs text-status-error">{error.message}</p>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary text-xs">
            Cancel
          </button>
          <button
            onClick={() => onEscalate(selectedTargetRole)}
            className="btn-primary text-xs"
            disabled={!selectedTargetRole || isPending}
          >
            {isPending ? 'Escalating...' : 'Escalate'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
