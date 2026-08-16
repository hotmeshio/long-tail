import { Modal } from './Modal';

interface ConfirmCancelModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  selectedCount?: number;
  isPending?: boolean;
  error?: Error | null;
  /** Replacement label from x-lt-labels.cancel — the challenge speaks it. */
  actionLabel?: string;
}

export function ConfirmCancelModal({
  open,
  onClose,
  onConfirm,
  selectedCount,
  isPending,
  error,
  actionLabel,
}: ConfirmCancelModalProps) {
  // One template for every vocabulary: the title carries the verb (the
  // pressed button's label), the body states the intent in general terms.
  const isBulk = !!selectedCount && selectedCount > 1;
  const label = actionLabel || 'Cancel';
  const title = isBulk ? `${label} ${selectedCount} Items` : label === 'Cancel' ? 'Cancel Item' : label;

  const body = isBulk
    ? `Are you sure you want to ${label}? This removes ${selectedCount} items from the work queue.`
    : `Are you sure you want to ${label}? This removes the item from the work queue.`;

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">{body}</p>
        <p className="text-xs text-text-tertiary">This action cannot be undone.</p>
        {error && <p className="text-xs text-status-error">{error.message}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} disabled={isPending} className="btn-secondary text-xs">
            Keep
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="bg-status-error text-text-inverse px-3 py-1.5 rounded-md text-xs hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isPending ? 'Working...' : `Yes, ${label}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
