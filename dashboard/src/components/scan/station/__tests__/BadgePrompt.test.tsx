import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BadgePrompt } from '../BadgePrompt';
import type { ScanPresentedChoice } from '../../../../api/scan-codes';

function claimChoice(overrides?: Partial<ScanPresentedChoice>): ScanPresentedChoice {
  return {
    index: 1,
    label: 'Claim & Work',
    verb: 'claim-show-detail',
    requireActingIdentity: true,
    withheld: true,
    ...overrides,
  };
}

function renderPrompt(overrides?: {
  choice?: ScanPresentedChoice;
  notPrimedMarkdown?: string;
  primed?: boolean;
}) {
  const onExecute = vi.fn();
  const onCancel = vi.fn();
  const props = {
    choice: overrides?.choice ?? claimChoice(),
    notPrimedMarkdown: overrides?.notPrimedMarkdown,
    primed: overrides?.primed ?? false,
    busy: false,
    onExecute,
    onCancel,
  };
  const view = render(<BadgePrompt {...props} />);
  const reprime = (primed: boolean) => view.rerender(<BadgePrompt {...props} primed={primed} />);
  return { ...view, onExecute, onCancel, reprime };
}

describe('BadgePrompt', () => {
  it('states the prompt with the pending action beneath', () => {
    renderPrompt();
    expect(screen.getByText('Scan your badge to continue')).toBeInTheDocument();
    expect(screen.getByText('to Claim & Work')).toBeInTheDocument();
  });

  it('shows the rule notPrimed markdown when present', () => {
    renderPrompt({ notPrimedMarkdown: '**Badge up** at the kiosk first.' });
    expect(screen.getByText(/at the kiosk first/)).toBeInTheDocument();
  });

  it('waits while unprimed — nothing executes', () => {
    const { onExecute } = renderPrompt();
    expect(onExecute).not.toHaveBeenCalled();
  });

  it('auto-executes the pending choice the moment the identity primes', () => {
    const { onExecute, reprime } = renderPrompt();
    reprime(true);
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onExecute).toHaveBeenCalledWith(expect.objectContaining({ index: 1, label: 'Claim & Work' }));
  });

  it('executes once per priming, not on every render', () => {
    const { onExecute, reprime } = renderPrompt();
    reprime(true);
    reprime(true);
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it('executes immediately when mounted already primed', () => {
    const { onExecute } = renderPrompt({ primed: true });
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it('asks first when the pending choice carries a confirm', () => {
    const choice = claimChoice({ confirm: { prompt: 'Claim this order?' } });
    const { onExecute, reprime } = renderPrompt({ choice });
    reprime(true);
    expect(onExecute).not.toHaveBeenCalled();
    expect(screen.getByText('Claim this order?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, continue' }));
    expect(onExecute).toHaveBeenCalledWith(expect.objectContaining({ index: 1 }));
  });

  it('backing out of the confirm cancels the stop-over', () => {
    const choice = claimChoice({ confirm: { prompt: 'Claim this order?' } });
    const { onExecute, onCancel, reprime } = renderPrompt({ choice });
    reprime(true);
    fireEvent.click(screen.getByRole('button', { name: 'No, go back' }));
    expect(onExecute).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('the cancel link hands control back', () => {
    const { onCancel } = renderPrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
