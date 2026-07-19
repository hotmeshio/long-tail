import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { ClaimExpiryModal } from '../ClaimExpiryModal';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function renderModal(overrides: Partial<Parameters<typeof ClaimExpiryModal>[0]> = {}) {
  const props = {
    open: true,
    assignedUntil: new Date(Date.now() + 80_000).toISOString(),
    onClose: vi.fn(),
    onExtend: vi.fn(),
    isPending: false,
    ...overrides,
  };
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ClaimExpiryModal {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, props };
}

describe('ClaimExpiryModal', () => {
  it('renders nothing when closed', () => {
    renderModal({ open: false });
    expect(screen.queryByText('Claim Expiring')).not.toBeInTheDocument();
  });

  it('renders the warning with a live countdown when open', () => {
    renderModal();
    expect(screen.getByText('Claim Expiring')).toBeInTheDocument();
    expect(screen.getByText(/expires in/i)).toBeInTheDocument();
    expect(screen.getByText(/edits are kept as a draft/i)).toBeInTheDocument();
  });

  it('is announced as a modal dialog', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('offers the configured claim durations plus a custom option', () => {
    renderModal();
    const select = screen.getByLabelText('Extension duration');
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).toContain('30 min');
    expect(labels).toContain('Other...');
  });

  it('extends with the selected duration', () => {
    const { props } = renderModal();
    fireEvent.change(screen.getByLabelText('Extension duration'), { target: { value: '60' } });
    fireEvent.click(screen.getByText('Extend Claim'));
    expect(props.onExtend).toHaveBeenCalledWith(60);
  });

  it('dismisses without extending', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByText('Dismiss'));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onExtend).not.toHaveBeenCalled();
  });

  it('disables the extend button while the extension is pending', () => {
    renderModal({ isPending: true });
    expect(screen.getByText('Extending...')).toBeDisabled();
  });
});
