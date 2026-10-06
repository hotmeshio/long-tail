import { describe, it, expect } from 'vitest';

import {
  applyScanToField,
  pickScanSink,
  readScanSink,
  scanFieldsFilled,
  validateResolverPayload,
  validateResolverForm,
  wantsScanSubmit,
} from '../../../shared/form-validation';

const tub = {
  type: 'string',
  'x-lt-scan': { schemes: [14], expect: ['metadata.binCode', 'envelope.offered_bin_code'], 'expect-error': 'This bag goes in {{expected}}.' },
};
const shoes = {
  type: 'array', items: { type: 'string' }, maxItems: 3,
  'x-lt-scan': { schemes: [16], expect: ['envelope.expected_upcs'], multiplicity: 'count' },
};
const schema = {
  type: 'object',
  'x-lt-order': ['note', 'binCode', 'shoes'],
  'x-lt-scan-submit': true,
  required: ['binCode'],
  properties: { note: { type: 'string' }, binCode: tub, shoes },
};
const ctx = {
  metadata: { binCode: 'SF-A-2' },
  envelope: { offered_bin_code: 'SF-C-1', expected_upcs: ['012345678905', '012345678905', '036000291452'] },
};

describe('readScanSink', () => {
  it('reads the field config; a field without schemes takes no scans', () => {
    expect(readScanSink(tub)).toMatchObject({ schemes: [14], value: 'target', expectError: 'This bag goes in {{expected}}.' });
    expect(readScanSink({ type: 'string', 'x-lt-scan': { schemes: [] } })).toBeNull();
    expect(readScanSink({ type: 'string' })).toBeNull();
  });
});

describe('pickScanSink', () => {
  it('a field that takes the scheme wins; none means the scan runs globally', () => {
    expect(pickScanSink(schema, {}, 14)).toBe('binCode');
    expect(pickScanSink(schema, {}, 16)).toBe('shoes');
    expect(pickScanSink(schema, {}, 11)).toBeNull();
  });

  it('the focused field wins when it takes the scheme', () => {
    const two = { properties: { a: tub, b: tub } };
    expect(pickScanSink(two, { a: 'SF-A-2' }, 14)).toBe('b');
    expect(pickScanSink(two, { a: 'SF-A-2' }, 14, 'a')).toBe('a');
  });
});

describe('applyScanToField', () => {
  it('the expected tub (or the offered one) fills the field', () => {
    expect(applyScanToField('', { version: 14, target: 'SF-A-2', code: '14:0:SF-A-2' }, tub, ctx)).toEqual({ ok: true, value: 'SF-A-2' });
    expect(applyScanToField('', { version: 14, target: 'SF-C-1', code: '14:0:SF-C-1' }, tub, ctx)).toEqual({ ok: true, value: 'SF-C-1' });
  });

  it('the wrong tub is a field error naming the right ones, and nothing is written', () => {
    expect(applyScanToField('', { version: 14, target: 'SF-B-9', code: '14:0:SF-B-9' }, tub, ctx))
      .toEqual({ ok: false, error: 'This bag goes in SF-A-2, SF-C-1.' });
  });

  it('a shoe expected twice takes two scans; GTIN and UPC-A compare equal', () => {
    const upc = { version: 16, target: '00012345678905', code: '012345678905' };
    const once = applyScanToField([], upc, shoes, ctx);
    expect(once).toEqual({ ok: true, value: ['00012345678905'] });
    const twice = applyScanToField((once as { value: unknown }).value, upc, shoes, ctx);
    expect(twice).toMatchObject({ ok: true });
    expect(applyScanToField((twice as { value: unknown }).value, upc, shoes, ctx)).toMatchObject({ ok: false });
  });
});

describe('scan-submit readiness', () => {
  it('a form submits on its own once every required scan field is filled', () => {
    expect(wantsScanSubmit(schema)).toBe(true);
    expect(scanFieldsFilled(schema, {})).toBe(false);
    expect(scanFieldsFilled(schema, { binCode: 'SF-A-2' })).toBe(true);
  });
});

describe('server and client run the same expect check', () => {
  it('a typed wrong tub fails validation on both sides', () => {
    expect(validateResolverForm(schema, { binCode: 'SF-B-9' }, ctx)).toEqual([
      expect.objectContaining({ field: 'binCode', message: 'This bag goes in SF-A-2, SF-C-1.' }),
    ]);
    expect(validateResolverPayload(schema, { binCode: 'SF-B-9' }, ctx).length).toBe(1);
    expect(validateResolverForm(schema, { binCode: 'SF-A-2' }, ctx)).toEqual([]);
  });
});
