import { describe, it, expect } from 'vitest';

import { assertValidScheme, assertValidSteps } from '../../../services/scan-code/validate';
import { SCAN_ENCODINGS, SCAN_VERBS, type ScanStep } from '../../../types';

const validScheme = {
  version: 10,
  name: 'Serial',
  target_facet: 'serialNumber',
  encoding: SCAN_ENCODINGS.DELIMITED,
  delimiter: ':',
};

describe('assertValidScheme', () => {
  it('accepts a valid delimited scheme', () => {
    expect(() => assertValidScheme(validScheme)).not.toThrow();
  });

  it('accepts a valid fixed scheme', () => {
    expect(() =>
      assertValidScheme({ ...validScheme, encoding: SCAN_ENCODINGS.FIXED, target_length: 8 }),
    ).not.toThrow();
  });

  it('rejects a version outside 10-99', () => {
    expect(() => assertValidScheme({ ...validScheme, version: 9 })).toThrow(/10 and 99/);
    expect(() => assertValidScheme({ ...validScheme, version: 100 })).toThrow(/10 and 99/);
  });

  it('rejects a missing target facet', () => {
    expect(() => assertValidScheme({ ...validScheme, target_facet: '' })).toThrow(/target_facet/);
  });

  it('rejects fixed encoding without a target length', () => {
    expect(() =>
      assertValidScheme({ ...validScheme, encoding: SCAN_ENCODINGS.FIXED, target_length: null }),
    ).toThrow(/target_length/);
  });

  it('rejects a digit delimiter', () => {
    expect(() => assertValidScheme({ ...validScheme, delimiter: '7' })).toThrow(/digit/);
  });

  it('rejects a multi-character delimiter', () => {
    expect(() => assertValidScheme({ ...validScheme, delimiter: '::' })).toThrow(/single-character/);
  });
});

describe('assertValidSteps', () => {
  const showDetail: ScanStep = { query: {}, verb: SCAN_VERBS.SHOW_DETAIL };

  it('accepts a well-formed step list', () => {
    const steps: ScanStep[] = [
      {
        query: { roles: ['queue-a'], availability: 'available' },
        verb: SCAN_VERBS.RESOLVE,
        params: { resolverPayload: { outcome: 'done' } },
      },
      showDetail,
    ];
    expect(() => assertValidSteps(steps)).not.toThrow();
  });

  it('rejects an unknown verb', () => {
    expect(() => assertValidSteps([{ query: {}, verb: 'explode' as any }])).toThrow(/unknown verb/);
  });

  it('rejects escalate without a target role', () => {
    expect(() =>
      assertValidSteps([{ query: {}, verb: SCAN_VERBS.ESCALATE }]),
    ).toThrow(/targetRole/);
  });

  it('rejects resolve without a resolver payload', () => {
    expect(() =>
      assertValidSteps([{ query: {}, verb: SCAN_VERBS.RESOLVE }]),
    ).toThrow(/resolverPayload/);
  });

  it('rejects confirm on a read verb', () => {
    expect(() =>
      assertValidSteps([{ ...showDetail, confirm: { prompt: 'Sure?' } }]),
    ).toThrow(/mutating/);
  });

  it('rejects confirm without a prompt', () => {
    expect(() =>
      assertValidSteps([{ query: {}, verb: SCAN_VERBS.CANCEL, confirm: { prompt: '' } }]),
    ).toThrow(/prompt/);
  });

  it('rejects facet guards on claim-locked steps (silently ignored otherwise)', () => {
    expect(() =>
      assertValidSteps([{ query: { facets: { state: 'ready' } }, verb: SCAN_VERBS.CANCEL }]),
    ).toThrow(/facet guards/);
    expect(() =>
      assertValidSteps([{ query: { facets: { state: 'ready' } }, verb: SCAN_VERBS.CLAIM }]),
    ).toThrow(/facet guards/);
  });

  it('allows facet guards on confirm steps (they only locate)', () => {
    expect(() =>
      assertValidSteps([
        { query: { facets: { state: 'ready' } }, verb: SCAN_VERBS.CANCEL, confirm: { prompt: 'Cancel this?' } },
      ]),
    ).not.toThrow();
  });
});
