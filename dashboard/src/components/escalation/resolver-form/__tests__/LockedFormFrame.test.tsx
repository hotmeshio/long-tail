import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LockedFormFrame } from '../LockedFormFrame';

describe('LockedFormFrame', () => {
  it('pops the hint at the click point and reports the gesture', () => {
    const onLockedClick = vi.fn();
    render(
      <LockedFormFrame hint="Claim this escalation to edit the form" onLockedClick={onLockedClick}>
        <p>locked body</p>
      </LockedFormFrame>,
    );
    expect(screen.queryByTestId('locked-form-hint')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('locked body'), { clientX: 240, clientY: 180 });
    expect(onLockedClick).toHaveBeenCalledOnce();
    const hint = screen.getByTestId('locked-form-hint');
    expect(hint).toHaveTextContent('Claim this escalation to edit the form');
    expect(hint.style.left).toBe('240px');
    expect(hint.style.top).toBe('168px');
  });

  it('a repeat click moves the hint to the new spot', () => {
    render(
      <LockedFormFrame hint="hint">
        <p>locked body</p>
      </LockedFormFrame>,
    );
    fireEvent.click(screen.getByText('locked body'), { clientX: 240, clientY: 180 });
    fireEvent.click(screen.getByText('locked body'), { clientX: 400, clientY: 300 });
    const hint = screen.getByTestId('locked-form-hint');
    expect(hint.style.left).toBe('400px');
    expect(hint.style.top).toBe('288px');
  });

  it('clamps the bubble away from the viewport edge', () => {
    render(
      <LockedFormFrame hint="hint">
        <p>locked body</p>
      </LockedFormFrame>,
    );
    fireEvent.click(screen.getByText('locked body'), { clientX: 4, clientY: 100 });
    expect(screen.getByTestId('locked-form-hint').style.left).toBe('96px');
  });

  it('renders no toast without a hint, but still reports clicks', () => {
    const onLockedClick = vi.fn();
    render(
      <LockedFormFrame onLockedClick={onLockedClick}>
        <p>locked body</p>
      </LockedFormFrame>,
    );
    fireEvent.click(screen.getByText('locked body'), { clientX: 10, clientY: 10 });
    expect(onLockedClick).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('locked-form-hint')).not.toBeInTheDocument();
  });
});
