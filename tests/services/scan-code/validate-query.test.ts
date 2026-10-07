import { describe, it, expect } from 'vitest';

import { assertValidSteps } from '../../../services/scan-code';
import type { ScanStep } from '../../../types';

const check = (step: ScanStep) => () => assertValidSteps([step]);
const hold = (query: ScanStep['query']): ScanStep => ({ query, verb: 'hold' });

describe('query.types and query.subtypes', () => {
  it('narrow steps that locate then act by id', () => {
    expect(check(hold({ roles: ['bin'], subtypes: ['packing'] }))).not.toThrow();
    expect(check({ query: { types: ['bin'] }, verb: 'show-list' })).not.toThrow();
    expect(check({ query: { subtypes: ['open'] }, verb: 'accumulate', params: { itemKey: '{scan.target}' } })).not.toThrow();
    expect(check({
      query: { subtypes: ['open'] }, verb: 'present',
      choices: [{ label: 'Dispatch', verb: 'resolve', params: { resolverPayload: {} } }, { label: 'View', verb: 'show-detail' }],
    })).not.toThrow();
  });

  it('must be non-empty arrays of strings', () => {
    expect(check(hold({ types: [] }))).toThrow(/query.types must be a non-empty array/);
    expect(check(hold({ subtypes: 'open' as any }))).toThrow(/query.subtypes must be a non-empty array/);
    expect(check(hold({ subtypes: [''] }))).toThrow(/query.subtypes/);
  });

  it('are refused on verbs whose write re-locates by the target facet', () => {
    for (const verb of ['claim', 'claim-show-detail', 'cancel', 'release', 'resolve'] as const) {
      expect(check({ query: { subtypes: ['open'] }, verb, params: { resolverPayload: {} } })).toThrow(/not supported on/);
    }
  });

  it('narrow a present step with any choice, since every choice writes the row it showed', () => {
    expect(check({
      query: { subtypes: ['open'] }, verb: 'present', autoSelectSingle: true,
      choices: [{ label: 'Start', verb: 'claim-show-detail', params: { durationMinutes: 30 } }],
    })).not.toThrow();
    expect(check({
      query: { types: ['bin'] }, verb: 'present',
      choices: [
        { label: 'Claim', verb: 'claim' },
        { label: 'Cancel', verb: 'cancel' },
        { label: 'Release', verb: 'release' },
        { label: 'Send on', verb: 'escalate', params: { targetRole: 'review', closeCurrent: 'resolve' } },
      ],
    })).not.toThrow();
  });

  it("take one entry each with availability 'mine'", () => {
    expect(check({ query: { availability: 'mine', subtypes: ['open'] }, verb: 'show-detail' })).not.toThrow();
    expect(check({ query: { availability: 'mine', subtypes: ['open', 'packing'] }, verb: 'show-detail' })).toThrow(/at most one/);
  });
});
