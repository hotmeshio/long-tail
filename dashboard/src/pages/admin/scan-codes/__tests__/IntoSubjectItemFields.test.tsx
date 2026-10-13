import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { IntoSubjectItemFields } from '../IntoSubjectItemFields';
import { SubjectStepFields } from '../SubjectStepFields';
import type { ScanStep } from '../../../../api/scan-codes';

const into = (accumulate: NonNullable<NonNullable<ScanStep['params']>['accumulate']>, over: Partial<ScanStep> = {}): ScanStep => ({
  query: {}, verb: 'accumulate', subject: { schemes: [14] }, refuse: { markdown: 'Not this one.' },
  params: { itemKey: '{scan.target}', accumulate }, ...over,
});

describe('IntoSubjectItemFields', () => {
  it('turning it on adds an empty item selector', () => {
    const onPatch = vi.fn();
    render(<IntoSubjectItemFields step={into({ into: 'subject' })} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onPatch).toHaveBeenCalledWith({ params: { itemKey: '{scan.target}', accumulate: { into: 'subject', item: {} } } });
  });

  it('edits the item queues and facets', () => {
    const onPatch = vi.fn();
    render(<IntoSubjectItemFields step={into({ into: 'subject', item: {} })} onPatch={onPatch} />);
    fireEvent.change(screen.getByLabelText('Item queues'), { target: { value: 'packing, ship' } });
    expect(onPatch).toHaveBeenLastCalledWith({ params: { itemKey: '{scan.target}', accumulate: { into: 'subject', item: { roles: ['packing', 'ship'] } } } });
    fireEvent.change(screen.getByLabelText('Item row has'), { target: { value: 'shape=consolidated' } });
    expect(onPatch).toHaveBeenLastCalledWith({ params: { itemKey: '{scan.target}', accumulate: { into: 'subject', item: { facets: { shape: 'consolidated' } } } } });
  });

  it('edits the not-waiting copy, and turning it off drops the copy too', () => {
    const onPatch = vi.fn();
    const step = into({ into: 'subject', item: { roles: ['packing'] } }, { refuse: { markdown: 'x', missing: 'Not waiting.' } });
    render(<IntoSubjectItemFields step={step} onPatch={onPatch} />);
    fireEvent.change(screen.getByLabelText('When the item is not waiting'), { target: { value: 'Gone.' } });
    expect(onPatch).toHaveBeenLastCalledWith({ refuse: { markdown: 'x', missing: 'Gone.' } });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onPatch).toHaveBeenLastCalledWith({
      params: { itemKey: '{scan.target}', accumulate: { into: 'subject' } },
      refuse: { markdown: 'x', missing: undefined },
    });
  });

  it('switching the held-item mode away from into drops the item selector', () => {
    const onPatch = vi.fn();
    render(<SubjectStepFields step={into({ into: 'subject', item: { roles: ['packing'] } })} onPatch={onPatch} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'from' } });
    expect(onPatch.mock.calls[0][0].params.accumulate).toEqual({ from: 'subject' });
  });
});
