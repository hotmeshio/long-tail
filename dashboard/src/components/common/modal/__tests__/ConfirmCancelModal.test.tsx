import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConfirmCancelModal } from '../ConfirmCancelModal';

// A role that renames the cancel control (x-lt-labels.cancel) gets a
// confirmation challenge in the same vocabulary — never a bare "Cancel" that
// contradicts the button the operator just pressed.

function renderModal(props: Partial<Parameters<typeof ConfirmCancelModal>[0]> = {}) {
  return render(
    <ConfirmCancelModal open onClose={vi.fn()} onConfirm={vi.fn()} {...props} />,
  );
}

describe('ConfirmCancelModal', () => {
  it('defaults to the cancel vocabulary in general work-item terms', () => {
    renderModal();
    expect(screen.getByText('Cancel Item')).toBeInTheDocument();
    expect(
      screen.getByText(/Are you sure you want to Cancel\? This removes the item from the work queue\./),
    ).toBeInTheDocument();
    expect(screen.getByText('Yes, Cancel')).toBeInTheDocument();
  });

  it('speaks the replacement label end to end when the control is renamed', () => {
    renderModal({ actionLabel: 'Send to Service' });
    expect(screen.getByText('Send to Service')).toBeInTheDocument();
    expect(
      screen.getByText(/Are you sure you want to Send to Service\? This removes the item from the work queue\./),
    ).toBeInTheDocument();
    expect(screen.getByText('Yes, Send to Service')).toBeInTheDocument();
    expect(screen.queryByText('Yes, Cancel')).not.toBeInTheDocument();
  });

  it('bulk cancels keep the count-based copy regardless of label', () => {
    renderModal({ selectedCount: 3, actionLabel: 'Send to Service' });
    expect(screen.getByText('Cancel 3 Items')).toBeInTheDocument();
    expect(screen.getByText(/removes 3 items from the work queue/)).toBeInTheDocument();
    expect(screen.getByText('Yes, Cancel')).toBeInTheDocument();
  });
});
