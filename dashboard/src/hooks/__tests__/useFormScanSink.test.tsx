import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The form's first look at a scan: a field that takes the scheme fills from
// it; anything else (other schemes, badges) passes on to the pipeline.
let interceptor: ((raw: string) => boolean) | null = null;
vi.mock('../useScanInput', () => ({
  useOptionalScanInput: () => ({
    pushCodeInterceptor: (fn: (raw: string) => boolean) => {
      interceptor = fn;
      return () => { interceptor = null; };
    },
  }),
}));
vi.mock('../../api/scan-codes', () => ({
  useScanSchemes: () => ({
    data: {
      schemes: [
        { version: 11, name: 'Bag', encoding: 'delimited', delimiter: ':', target_length: null, enabled: true, kind: 'action' },
        { version: 12, name: 'Badge', encoding: 'delimited', delimiter: ':', target_length: null, enabled: true, kind: 'identity' },
        { version: 14, name: 'Tub', encoding: 'delimited', delimiter: ':', target_length: null, enabled: true, kind: 'action' },
      ],
    },
  }),
}));

import { useFormScanSink } from '../useFormScanSink';

const schema = {
  'x-lt-scan-submit': true,
  required: ['binCode'],
  properties: {
    binCode: { type: 'string', title: 'Tub', 'x-lt-scan': { schemes: [14], expect: ['metadata.binCode'], 'expect-error': 'This bag goes in {{expected}}.' } },
  },
};
const context = { metadata: { binCode: 'SF-A-2' } };

function setup(enabled = true) {
  const onJsonChange = vi.fn();
  const onScanSubmit = vi.fn();
  const view = renderHook(() => useFormScanSink({
    enabled, json: JSON.stringify({ _form_schema: schema }), onJsonChange, context, onScanSubmit,
  }));
  return { ...view, onJsonChange, onScanSubmit };
}

beforeEach(() => { interceptor = null; });

describe('useFormScanSink', () => {
  it('the right tub fills the field and submits the filled form', () => {
    const { onJsonChange, onScanSubmit } = setup();
    let consumed = false;
    act(() => { consumed = interceptor!('14:0:SF-A-2'); });
    expect(consumed).toBe(true);
    const written = JSON.parse(onJsonChange.mock.calls[0][0]);
    expect(written.binCode).toBe('SF-A-2');
    expect(onScanSubmit).toHaveBeenCalledWith(onJsonChange.mock.calls[0][0]);
  });

  it('the wrong tub is consumed as a field error and nothing is written', () => {
    const { result, onJsonChange, onScanSubmit } = setup();
    act(() => { interceptor!('14:0:SF-B-9'); });
    expect(onJsonChange).not.toHaveBeenCalled();
    expect(onScanSubmit).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ field: 'binCode', error: 'This bag goes in SF-A-2.' });
  });

  it('a badge and a code no field takes pass on to the pipeline', () => {
    setup();
    expect(interceptor!('12:0:HB-MARIA')).toBe(false);
    expect(interceptor!('11:0:K7Q2M9XA')).toBe(false);
  });

  it('a form that cannot be edited takes no scans', () => {
    setup(false);
    expect(interceptor).toBeNull();
  });
});
