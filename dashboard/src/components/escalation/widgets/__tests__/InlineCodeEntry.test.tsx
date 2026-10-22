import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InlineCodeEntry } from '../InlineCodeEntry';
import { ownsItsKeys } from '../../../../lib/scan-sources/types';

function renderEntry() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<InlineCodeEntry label="Key in" onConfirm={onConfirm} onCancel={onCancel} testId="key-in" />);
  return { onConfirm, onCancel, input: screen.getByTestId('key-in-input') };
}

describe('InlineCodeEntry', () => {
  it('keeps its keys from the scan capture', () => {
    const { input } = renderEntry();
    expect(ownsItsKeys(input)).toBe(true);
  });

  it('confirms the trimmed code on Enter', () => {
    const { input, onConfirm } = renderEntry();
    fireEvent.change(input, { target: { value: ' 0812999000011 ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledWith('0812999000011');
  });

  it('cancels on Escape', () => {
    const { input, onCancel } = renderEntry();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('leaves the confirm disabled until a code is typed', () => {
    renderEntry();
    expect(screen.getByTestId('key-in-yes')).toBeDisabled();
  });
});
