import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SubjectStepFields } from '../SubjectStepFields';
import type { ScanStep } from '../../../../api/scan-codes';

describe('SubjectStepFields', () => {
  it('a hold step edits the next scan it asks for', () => {
    const onPatch = vi.fn();
    render(<SubjectStepFields step={{ query: {}, verb: 'hold' }} onPatch={onPatch} />);
    fireEvent.change(screen.getByLabelText('Next scan schemes'), { target: { value: '14, 15' } });
    expect(onPatch).toHaveBeenCalledWith({ params: { hold: { expect: { schemes: [14, 15] } } } });
  });

  it('pairing an accumulate with the held item opens a subject gate', () => {
    const onPatch = vi.fn();
    const step: ScanStep = { query: {}, verb: 'accumulate', params: { itemKey: '{scan.target}' } };
    render(<SubjectStepFields step={step} onPatch={onPatch} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'from' } });
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({
      params: { itemKey: '{scan.target}', accumulate: { from: 'subject' } },
      subject: { schemes: [] },
    }));
  });

  it('a subject step edits what it must match and what it says when wrong', () => {
    const onPatch = vi.fn();
    const step: ScanStep = {
      query: {}, verb: 'accumulate', subject: { schemes: [11] },
      params: { itemKey: '{subject.orderId}', accumulate: { from: 'subject' } },
    };
    render(<SubjectStepFields step={step} onPatch={onPatch} />);
    fireEvent.change(screen.getByLabelText('Must match'), { target: { value: '{subject.binCode}' } });
    expect(onPatch).toHaveBeenLastCalledWith({ match: { target: ['{subject.binCode}'] } });
    fireEvent.change(screen.getByLabelText('When it is the wrong one'), { target: { value: 'Goes in {subject.binCode}.' } });
    expect(onPatch).toHaveBeenLastCalledWith({ refuse: { markdown: 'Goes in {subject.binCode}.' } });
  });

  it('a subject step can apply only to held items in a given state', () => {
    const onPatch = vi.fn();
    const step: ScanStep = {
      query: {}, verb: 'accumulate', subject: { schemes: [11] },
      params: { itemKey: '{subject.orderId}', accumulate: { from: 'subject' } },
    };
    render(<SubjectStepFields step={step} onPatch={onPatch} />);
    fireEvent.change(screen.getByLabelText('Only when the held item has'), { target: { value: 'binState=unbound' } });
    expect(onPatch).toHaveBeenLastCalledWith({ subject: { schemes: [11], facets: { binState: 'unbound' } } });
  });

  it('a hold edits the headline and the line under it', () => {
    const onPatch = vi.fn();
    render(<SubjectStepFields step={{ query: {}, verb: 'hold' }} onPatch={onPatch} />);
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: '{item.binCode}' } });
    expect(onPatch).toHaveBeenLastCalledWith({ params: { hold: { headline: '{item.binCode}' } } });
    fireEvent.change(screen.getByLabelText('Under the headline'), { target: { value: '{item.facilityName}' } });
    expect(onPatch).toHaveBeenLastCalledWith({ params: { hold: { subline: '{item.facilityName}' } } });
  });

  it('a subject step edits what the station shows when it lands', () => {
    const onPatch = vi.fn();
    const step: ScanStep = {
      query: {}, verb: 'accumulate', subject: { schemes: [11] },
      params: { itemKey: '{subject.orderId}', accumulate: { from: 'subject' } },
    };
    render(<SubjectStepFields step={step} onPatch={onPatch} />);
    fireEvent.change(screen.getByLabelText('When it lands'), { target: { value: 'Drop it in **{container.binCode}**.' } });
    expect(onPatch).toHaveBeenLastCalledWith({ done: { markdown: 'Drop it in **{container.binCode}**.' } });
  });

  it('other verbs render nothing', () => {
    const { container } = render(<SubjectStepFields step={{ query: {}, verb: 'claim' }} onPatch={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
