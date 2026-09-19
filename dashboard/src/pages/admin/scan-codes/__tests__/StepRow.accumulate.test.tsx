import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '../../../../test/render';
import { StepRow, VERB_LABELS } from '../StepRow';
import { SCAN_VERBS, type ScanStep } from '../../../../api/scan-codes';

// The accumulate verb has two authoring shapes: container mode (the scan
// names the container, an item key template names the item) and item mode
// (a container facet joins the scanned item to its container). The row
// shows exactly the controls each mode needs.
function renderRow(step: ScanStep) {
  const onPatch = vi.fn();
  renderWithProviders(
    <StepRow index={0} step={step} roleKeys={['bin', 'bag']} isLast onPatch={onPatch} onMove={() => {}} onRemove={() => {}} />,
  );
  return onPatch;
}

describe('StepRow — accumulate', () => {
  it('labels the verb and offers it in the verb select', () => {
    renderRow({ query: {}, verb: SCAN_VERBS.SHOW_DETAIL });
    expect(VERB_LABELS[SCAN_VERBS.ACCUMULATE]).toBe('Add to an accumulator');
    expect(screen.getByRole('option', { name: 'Add to an accumulator' })).toBeTruthy();
  });

  it('container mode asks for the item key template and an optional payload', () => {
    const onPatch = renderRow({ query: {}, verb: SCAN_VERBS.ACCUMULATE, params: {} });
    expect(screen.getByLabelText('Container facet')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Item key'), { target: { value: '{claim.orderId}' } });
    expect(onPatch).toHaveBeenCalledWith({ params: { itemKey: '{claim.orderId}' } });
    expect(screen.getByText(/Item payload/)).toBeTruthy();
    expect(screen.queryByText(/Container queues/)).toBeNull();
  });

  it('item mode swaps the item key for container queues and the reciprocal toggle', () => {
    const onPatch = renderRow({
      query: {}, verb: SCAN_VERBS.ACCUMULATE, params: { accumulate: { containerFacet: 'binKey' } },
    });
    expect(screen.queryByLabelText('Item key')).toBeNull();
    expect(screen.getByText(/Container queues/)).toBeTruthy();
    const reciprocal = screen.getByRole('checkbox', { name: /record the container on the item/i });
    expect(reciprocal).toBeChecked();
    fireEvent.click(reciprocal);
    expect(onPatch).toHaveBeenCalledWith({ params: { accumulate: { containerFacet: 'binKey', reciprocal: false } } });
  });
});
