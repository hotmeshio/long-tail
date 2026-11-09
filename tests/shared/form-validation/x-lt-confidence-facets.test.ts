import { describe, it, expect } from 'vitest';
import {
  REVIEW_FACET_KEYS,
  REVIEW_OUTCOMES,
  buildReviewFacets,
  visibleFieldKeys,
} from '../../../shared/form-validation/x-lt-confidence-facets';

const schema = {
  'x-lt-confidence': {
    tranches: [
      { below: 0.6, label: 'Low', tone: 'error' },
      { below: 0.85, label: 'Check', tone: 'warning' },
    ],
    facets: true,
  },
  properties: {
    first: { type: 'string', 'x-lt-bind': 'applicant.first' },
    plan: { type: 'string' },
    city: { type: 'string' },
    extra: { type: 'string', 'x-lt-showIf': 'resolver.plan=family' },
    secret: { type: 'string', 'x-lt-hidden': true },
    doc: { type: 'string', 'x-lt-widget': 'document' },
  },
};

const ctx = {
  envelope: {
    formDefaults: { applicant: { first: 'Jon' }, plan: 'solo', city: 'Portland', extra: 'x', secret: 'a' },
    confidence: { applicant: { first: 0.52 }, plan: 0.7, city: 0.95, extra: 0.1, secret: 0.1 },
  },
};

describe('buildReviewFacets', () => {
  it('counts corrections over shown fields and names the lowest tranche', () => {
    const facets = buildReviewFacets(schema, ctx, { first: 'John', plan: 'solo', city: 'Portland', extra: 'y', secret: 'b' });
    expect(facets).toEqual({
      [REVIEW_FACET_KEYS.OUTCOME]: REVIEW_OUTCOMES.CORRECTED,
      [REVIEW_FACET_KEYS.CHANGED]: '1',
      [REVIEW_FACET_KEYS.WORST]: 'Low',
    });
  });

  it('reports an accepted review when nothing changed, whitespace included', () => {
    const facets = buildReviewFacets(schema, ctx, { first: ' Jon ', plan: 'solo', city: 'Portland' });
    expect(facets?.[REVIEW_FACET_KEYS.OUTCOME]).toBe(REVIEW_OUTCOMES.ACCEPTED);
    expect(facets?.[REVIEW_FACET_KEYS.CHANGED]).toBe('0');
  });

  it('counts a field revealed by the answer', () => {
    const facets = buildReviewFacets(schema, ctx, { first: 'Jon', plan: 'family', city: 'Portland', extra: 'y' });
    expect(facets?.[REVIEW_FACET_KEYS.CHANGED]).toBe('2');
  });

  it('omits the worst tranche when every shown score clears', () => {
    const confident = { envelope: { formDefaults: { city: 'Portland' }, confidence: { city: 0.95 } } };
    const facets = buildReviewFacets(schema, confident, { city: 'Portland' });
    expect(facets).toEqual({ [REVIEW_FACET_KEYS.OUTCOME]: REVIEW_OUTCOMES.ACCEPTED, [REVIEW_FACET_KEYS.CHANGED]: '0' });
  });

  it('is null without the opt-in, without a schema, or with nothing reviewed', () => {
    const optedOut = { ...schema, 'x-lt-confidence': { tranches: [] } };
    expect(buildReviewFacets(optedOut, ctx, { first: 'John' })).toBeNull();
    expect(buildReviewFacets(null, ctx, {})).toBeNull();
    expect(buildReviewFacets(schema, { envelope: {} }, { first: 'John' })).toBeNull();
  });
});

describe('visibleFieldKeys', () => {
  it('applies x-lt-hidden and x-lt-showIf against the answer', () => {
    expect(visibleFieldKeys(schema, { plan: 'solo' }, { resolver: { plan: 'solo' } })).toEqual(['first', 'plan', 'city', 'doc']);
    expect(visibleFieldKeys(schema, { plan: 'family' }, { resolver: { plan: 'family' } })).toContain('extra');
  });
});
