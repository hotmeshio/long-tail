import { describe, it, expect } from 'vitest';

import { readScanSink, scanTargetCount } from '../../../shared/form-validation';

const ctx = { envelope: { upcs: ['111', '222', '111'] } };
const field = (scan: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ type: 'array', items: { type: 'string' }, 'x-lt-scan': { schemes: [16], ...scan }, ...extra });

describe('x-lt-scan checklist', () => {
  it('reads a declared prompt, ignoring a blank one', () => {
    expect(readScanSink(field({ prompt: 'Scan each part' }))?.prompt).toBe('Scan each part');
    expect(readScanSink(field({ prompt: '  ' }))?.prompt).toBeUndefined();
  });

  it('counts what the expected list admits: each distinct value, or each listing under count', () => {
    expect(scanTargetCount(field({ expect: ['envelope.upcs'] }), ctx)).toBe(2);
    expect(scanTargetCount(field({ expect: ['envelope.upcs'], multiplicity: 'count' }), ctx)).toBe(3);
  });

  it('falls back to maxItems, then to no target', () => {
    expect(scanTargetCount(field({}, { maxItems: 5 }), ctx)).toBe(5);
    expect(scanTargetCount(field({}), ctx)).toBeNull();
    expect(scanTargetCount({ type: 'array', maxItems: 2 }, ctx)).toBe(2);
  });
});
