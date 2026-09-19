import { describe, it, expect } from 'vitest';

import { parseScanCode, interpolateScanTemplate, mentionsClaimToken, ScanTemplateError } from '../../../services/scan-code/parse';
import { SCAN_ENCODINGS, type ScanScheme } from '../../../types';

const delimited: ScanScheme = {
  version: 10,
  name: 'Serial (delimited)',
  description: null,
  target_facet: 'serialNumber',
  encoding: SCAN_ENCODINGS.DELIMITED,
  delimiter: ':',
  target_length: null,
  enabled: true,
};

const fixed: ScanScheme = {
  version: 11,
  name: 'Serial (fixed)',
  description: null,
  target_facet: 'serialNumber',
  encoding: SCAN_ENCODINGS.FIXED,
  delimiter: ':',
  target_length: 8,
  enabled: true,
};

const schemes = [delimited, fixed];

describe('parseScanCode — delimited encoding', () => {
  it('parses version, category, and target', () => {
    const result = parseScanCode('10:1:SN-7594', schemes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed).toEqual({ version: 10, category: '1', target: 'SN-7594' });
      expect(result.scheme.target_facet).toBe('serialNumber');
    }
  });

  it('keeps delimiter characters inside the target', () => {
    const result = parseScanCode('10:4:a:b:c', schemes);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.parsed.target).toBe('a:b:c');
  });

  it('trims surrounding whitespace from the wedge', () => {
    const result = parseScanCode('  10:1:SN1  ', schemes);
    expect(result.ok).toBe(true);
  });

  it('rejects a two-digit category', () => {
    const result = parseScanCode('10:12:SN1', schemes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe('malformed');
  });

  it('rejects an empty target', () => {
    const result = parseScanCode('10:1:', schemes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe('malformed');
  });

  it('rejects a missing delimiter after the two-digit scheme', () => {
    const result = parseScanCode('101:SN1', schemes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe('malformed');
  });
});

describe('parseScanCode — fixed encoding', () => {
  it('parses one category digit then target_length digits', () => {
    const result = parseScanCode('11075433211', schemes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed).toEqual({ version: 11, category: '0', target: '75433211' });
    }
  });

  it('accepts one trailing check digit (UPC-A wedge output)', () => {
    const result = parseScanCode('110754332119', schemes);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.parsed.target).toBe('75433211');
  });

  it('rejects non-digit characters', () => {
    const result = parseScanCode('110SN433211', schemes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe('malformed');
  });

  it('rejects a wrong length', () => {
    const result = parseScanCode('110754', schemes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe('malformed');
  });
});

describe('parseScanCode — scheme resolution', () => {
  it('fails on an empty code', () => {
    const result = parseScanCode('', schemes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe('empty');
  });

  it('fails on a non-digit scheme prefix', () => {
    const result = parseScanCode('x0:1:SN1', schemes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe('unknown_version');
  });

  it('fails on a scheme below 10 (leading-zero codes reserved out)', () => {
    const result = parseScanCode('09:1:SN1', schemes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe('unknown_version');
  });

  it('fails when no scheme exists for the version', () => {
    const result = parseScanCode('12:1:SN1', schemes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe('unknown_version');
  });

  it('fails loudly when the scheme is disabled', () => {
    const result = parseScanCode('10:1:SN1', [{ ...delimited, enabled: false }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe('scheme_disabled');
  });
});

describe('interpolateScanTemplate', () => {
  const ctx = { target: 'SN-1', category: '3', scannedAt: '2026-07-28T00:00:00Z' };

  it('replaces tokens inside nested objects and arrays', () => {
    const out = interpolateScanTemplate(
      {
        outcome: 'fail',
        serial: '{scan.target}',
        note: 'scanned {scan.category} at {scan.scannedAt}',
        tags: ['{scan.target}', 'fixed'],
        nested: { at: '{scan.scannedAt}' },
      },
      ctx,
    );
    expect(out).toEqual({
      outcome: 'fail',
      serial: 'SN-1',
      note: 'scanned 3 at 2026-07-28T00:00:00Z',
      tags: ['SN-1', 'fixed'],
      nested: { at: '2026-07-28T00:00:00Z' },
    });
  });

  it('leaves non-string values and unknown tokens untouched', () => {
    const out = interpolateScanTemplate({ n: 4, keep: '{scan.unknown}' }, ctx);
    expect(out).toEqual({ n: 4, keep: '{scan.unknown}' });
  });

  it('does not mutate the input', () => {
    const input = { serial: '{scan.target}' };
    interpolateScanTemplate(input, ctx);
    expect(input.serial).toBe('{scan.target}');
  });

  it('reads {claim.<facet>} and {item.<facet>} from the context bags', () => {
    const out = interpolateScanTemplate(
      { itemKey: '{claim.orderId}', note: 'bin {item.binKey} for {claim.orderId}', n: { w: '{item.weight}' } },
      { ...ctx, claim: { orderId: 'ORD-9' }, item: { binKey: 'B-7', weight: 2 } },
    );
    expect(out).toEqual({ itemKey: 'ORD-9', note: 'bin B-7 for ORD-9', n: { w: '2' } });
  });

  it('fails loud when a bag or facet is missing, never writing the literal', () => {
    expect(() => interpolateScanTemplate({ k: '{claim.orderId}' }, ctx)).toThrow(ScanTemplateError);
    expect(() => interpolateScanTemplate({ k: '{claim.orderId}' }, ctx)).toThrow(/no single live claim/);
    expect(() => interpolateScanTemplate({ k: '{item.binKey}' }, { ...ctx, item: {} })).toThrow(/facet binKey is absent/);
    expect(() => interpolateScanTemplate({ k: '{claim.orderId}' }, { ...ctx, claim: { orderId: '' } })).toThrow(ScanTemplateError);
  });

  it('mentionsClaimToken spots a claim token anywhere in the params', () => {
    expect(mentionsClaimToken({ itemKey: '{claim.orderId}' })).toBe(true);
    expect(mentionsClaimToken({ nested: { list: ['{claim.x}'] } })).toBe(true);
    expect(mentionsClaimToken({ itemKey: '{item.orderId}' })).toBe(false);
    expect(mentionsClaimToken(undefined)).toBe(false);
  });
});
