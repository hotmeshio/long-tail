import { Modal } from './Modal';
import type { ReactNode } from 'react';

interface ConfirmDeleteModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: ReactNode;
  isPending?: boolean;
  error?: Error | null;
}

export function ConfirmDeleteModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  isPending,
  error,
}: ConfirmDeleteModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">{description}</p>
        {error && <p className="text-xs text-status-error">{error.message}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary text-xs">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="bg-status-error text-white px-3 py-1.5 rounded-md text-xs hover:opacity-90 transition-opacity"
            disabled={isPending}
          >
            {isPending ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
