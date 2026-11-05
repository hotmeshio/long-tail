import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ScanDoneSection, patchScanDoneDraft, readScanDoneDraft } from '../sections/ScanDoneSection';
import type { Draft } from '../role-detail-shared';

describe('scan_done draft helpers', () => {
  it('writes and clears fields without disturbing the rest of the bag', () => {
    const withDone = patchScanDoneDraft('{"kiosk":true}', { return: 'home', after_seconds: 3 })!;
    expect(JSON.parse(withDone)).toEqual({ kiosk: true, scan_done: { return: 'home', after_seconds: 3 } });
    expect(readScanDoneDraft(withDone)).toEqual({ return: 'home', after_seconds: 3 });
    const cleared = patchScanDoneDraft(withDone, { return: undefined, after_seconds: undefined })!;
    expect(JSON.parse(cleared)).toEqual({ kiosk: true });
  });

  it('leaves an unparseable bag alone', () => {
    expect(patchScanDoneDraft('{oops', { return: 'home' })).toBeNull();
  });
});

describe('ScanDoneSection', () => {
  it('choosing the role home writes properties.scan_done', () => {
    const update = vi.fn();
    render(<ScanDoneSection draft={{ properties: '{}' } as Draft} update={update} />);
    fireEvent.change(screen.getByLabelText('Return to'), { target: { value: 'home' } });
    expect(JSON.parse(update.mock.calls[0][0].properties)).toEqual({ scan_done: { return: 'home' } });
  });

  it('a route and a pause', () => {
    const update = vi.fn();
    render(<ScanDoneSection draft={{ properties: '{"scan_done":{"return":"/x"}}' } as Draft} update={update} />);
    fireEvent.change(screen.getByLabelText('Return after (seconds)'), { target: { value: '5' } });
    expect(JSON.parse(update.mock.calls[0][0].properties)).toEqual({ scan_done: { return: '/x', after_seconds: 5 } });
  });
});
