import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// A batch roster that declares x-lt-scan takes scans on the open form: the
// entry is checked off on the server, and the answer reads at the field.
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
        { version: 16, name: 'Item', encoding: 'delimited', delimiter: ':', target_length: null, enabled: true, kind: 'action' },
        { version: 12, name: 'Badge', encoding: 'delimited', delimiter: ':', target_length: null, enabled: true, kind: 'identity' },
      ],
    },
  }),
}));

import { useFormScanSink } from '../useFormScanSink';

const schema = {
  properties: {
    items: {
      type: 'string', readOnly: true, 'x-lt-widget': 'roster',
      'x-lt-roster': { expected: { batch: true } },
      'x-lt-scan': { schemes: [16] },
    },
  },
};

function setup(onRosterScan?: (field: string, code: string) => Promise<string | null>) {
  const onJsonChange = vi.fn();
  const view = renderHook(() => useFormScanSink({
    enabled: true, json: JSON.stringify({ _form_schema: schema }), onJsonChange, context: {}, onScanSubmit: vi.fn(), onRosterScan,
  }));
  return { ...view, onJsonChange };
}

beforeEach(() => { interceptor = null; });

describe('useFormScanSink: a batch roster', () => {
  it('checks the entry off on the server, with nothing focused, and writes no form value', async () => {
    const onRosterScan = vi.fn(async () => null);
    const { result, onJsonChange } = setup(onRosterScan);
    let consumed = false;
    act(() => { consumed = interceptor!('16:0:ITEM-1'); });
    expect(consumed).toBe(true);
    expect(onRosterScan).toHaveBeenCalledWith('items', '16:0:ITEM-1');
    expect(onJsonChange).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current).toMatchObject({ field: 'items', error: null }));
  });

  it('a refusal reads at the field', async () => {
    const { result } = setup(async () => 'Not one of the items expected here.');
    act(() => { interceptor!('16:0:OTHER'); });
    await waitFor(() => expect(result.current).toMatchObject({ field: 'items', error: 'Not one of the items expected here.' }));
  });

  it('a page that cannot check entries off passes the scan on', () => {
    setup();
    expect(interceptor!('16:0:ITEM-1')).toBe(false);
  });

  it('a badge still passes on to the pipeline', () => {
    setup(vi.fn(async () => null));
    expect(interceptor!('12:0:HB-MARIA')).toBe(false);
  });
});
