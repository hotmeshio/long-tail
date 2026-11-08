import { Modal } from '../common/modal/Modal';

interface ConfirmProps {
  count: number;
  /** True for badges; false for templates marked sensitive. */
  identity: boolean;
  action?: 'print' | 'reissue';
  isPending?: boolean;
  error?: Error | null;
  onConfirm: () => void;
  onClose: () => void;
}

function heading({ count, identity, action }: Pick<ConfirmProps, 'count' | 'identity' | 'action'>): string {
  if (action === 'reissue') return 'Reissue badge';
  const noun = identity ? (count === 1 ? 'badge' : 'badges') : (count === 1 ? 'label' : 'labels');
  return `Print ${count} ${noun}`;
}

/**
 * The confirmation every sensitive print passes through. Badges act as their
 * holders, so the requester sees what they are about to make and that their
 * account is recorded before any code is composed.
 */
export function CredentialConfirm({ count, identity, action = 'print', isPending, error, onConfirm, onClose }: ConfirmProps) {
  return (
    <div role="alertdialog" aria-label={heading({ count, identity, action })} className="space-y-3 text-sm text-text-secondary border-l-2 border-l-accent pl-4">
      <p className="font-medium text-text-primary">{heading({ count, identity, action })}</p>
      {action === 'reissue' ? (
        <p>The current badge stops working now and a new one prints. Each badge acts as its holder at any station.</p>
      ) : identity ? (
        <p>Each badge acts as its holder at any station. Keep printed badges with their holders.</p>
      ) : (
        <p>This template is marked sensitive. The labels print once you confirm.</p>
      )}
      <p>Your account is recorded as the requester{identity ? ', with each holder named' : ''}.</p>
      {error && <p role="alert" className="text-xs text-status-error">{error.message}</p>}
      <div className="flex justify-end gap-3 pt-1">
        <button onClick={onClose} className="btn-secondary text-xs">Keep</button>
        <button onClick={onConfirm} disabled={isPending} className="btn-primary text-xs">
          {isPending ? 'Printing…' : action === 'reissue' ? 'Reissue and print' : 'Confirm and print'}
        </button>
      </div>
    </div>
  );
}

/** The confirmation as its own dialog, for a print started outside the print panel. */
export function CredentialConfirmModal({ open, ...props }: ConfirmProps & { open: boolean }) {
  return (
    <Modal open={open} onClose={props.onClose} title={heading(props)} closeOnBackdrop={false}>
      <CredentialConfirm {...props} />
    </Modal>
  );
}
