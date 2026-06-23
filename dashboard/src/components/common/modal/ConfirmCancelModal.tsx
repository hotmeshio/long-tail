import { Modal } from './Modal';

interface ConfirmCancelModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  selectedCount?: number;
  isPending?: boolean;
  error?: Error | null;
}

export function ConfirmCancelModal({
  open,
  onClose,
  onConfirm,
  selectedCount,
  isPending,
  error,
}: ConfirmCancelModalProps) {
  const title = selectedCount && selectedCount > 1
    ? `Cancel ${selectedCount} escalations`
    : 'Cancel escalation';

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          {selectedCount && selectedCount > 1
            ? `This will permanently cancel ${selectedCount} escalations. Any waiting workflows will be unblocked and receive a cancellation signal.`
            : 'This will permanently cancel this escalation. Any waiting workflow will be unblocked and receive a cancellation signal.'}
        </p>
        <p className="text-xs text-text-tertiary">This action cannot be undone.</p>
        {error && <p className="text-xs text-status-error">{error.message}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} disabled={isPending} className="btn-secondary text-xs">
            Keep
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="bg-status-error text-white px-3 py-1.5 rounded-md text-xs hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isPending ? 'Cancelling...' : 'Yes, Cancel'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
