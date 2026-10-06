import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '../../../../test/render';
import { StepRow, VERB_LABELS } from '../StepRow';
import { SCAN_VERBS, type ScanStep } from '../../../../api/scan-codes';

// The bench verbs: choosing fill seeds the shape it needs, hold offers its
// own controls, and a step that acts on a held item drops the confirm prompt.
function renderRow(step: ScanStep) {
  const onPatch = vi.fn();
  renderWithProviders(
    <StepRow index={0} step={step} roleKeys={['bin', 'bag']} isLast onPatch={onPatch} onMove={() => {}} onRemove={() => {}} />,
  );
  return onPatch;
}

describe('StepRow — bench verbs', () => {
  it('choosing fill seeds a fill into the held item with a subject gate', () => {
    const onPatch = renderRow({ query: {}, verb: SCAN_VERBS.SHOW_DETAIL });
    fireEvent.change(screen.getByDisplayValue(VERB_LABELS[SCAN_VERBS.SHOW_DETAIL]), { target: { value: SCAN_VERBS.FILL } });
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({
      verb: SCAN_VERBS.FILL, params: { fill: { into: 'subject' } }, subject: { schemes: [] },
    }));
  });

  it('a hold step shows its own controls and no confirmation', () => {
    renderRow({ query: {}, verb: SCAN_VERBS.HOLD });
    expect(screen.getByLabelText('Next scan schemes')).toBeTruthy();
    expect(screen.queryByText('Confirmation')).toBeNull();
  });

  it('a from-subject accumulate hides item mode and asks what it must match', () => {
    renderRow({
      query: {}, verb: SCAN_VERBS.ACCUMULATE, subject: { schemes: [11] },
      params: { itemKey: '{subject.orderId}', accumulate: { from: 'subject' } },
    });
    expect(screen.queryByLabelText('Container facet')).toBeNull();
    expect(screen.getByLabelText('Must match')).toBeTruthy();
  });
});
