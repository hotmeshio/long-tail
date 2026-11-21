import { describe, it, expect } from 'vitest';
import { buildFormReview, readConfidenceSpec, summarizeReview } from '../../../shared/form-validation/x-lt-confidence';
import { REVIEW_FACET_KEYS, buildReviewFacets } from '../../../shared/form-validation/x-lt-confidence-facets';

const schema = {
  'x-lt-confidence': { facets: true },
  properties: {
    name: { type: 'string' },
    codes: { type: ['array', 'null'], items: { type: 'string' }, 'x-lt-bind': 'facts.codes' },
    lines: {
      type: 'array',
      'x-lt-item-key': 'code',
      'x-lt-bind': 'facts.lines',
      items: {
        type: 'object',
        properties: { code: { type: 'string', 'x-lt-confidence': false }, qty: { type: 'integer' } },
      },
    },
  },
};
const spec = readConfidenceSpec(schema)!;
const ctxFor = (confidence: unknown, formDefaults: unknown) => ({ envelope: { confidence, formDefaults } });

describe('list review', () => {
  const proposed = { name: 'Jon', facts: { codes: ['E11', 'I73'], lines: [{ code: 'A1', qty: 1 }, { code: 'A2', qty: 2 }] } };

  it('keeps a scalar score as the list-level score', () => {
    const review = buildFormReview(spec, schema, ctxFor({ facts: { codes: 0.79 } }, proposed), { codes: ['E11', 'I73'] });
    expect(review.codes).toMatchObject({ score: 0.79, tranche: { label: 'Check' }, changed: false });
    expect(review.codes.itemTranches).toBeUndefined();
  });

  it('reads an aligned array of item scores; the field is the worst of its items', () => {
    const review = buildFormReview(spec, schema, ctxFor({ facts: { codes: [0.95, 0.4] } }, proposed), { codes: ['E11', 'I73'] });
    expect(review.codes.score).toBe(0.4);
    expect(review.codes.tranche?.label).toBe('Low');
    expect(review.codes.itemTranches?.map((t) => t?.label ?? null)).toEqual([null, 'Low']);
  });

  it('scores row cells from an object per item and skips a column that opts out', () => {
    const scores = { facts: { lines: [{ code: 0.1, qty: 0.99 }, { code: 0.99, qty: 0.55 }] } };
    const review = buildFormReview(spec, schema, ctxFor(scores, proposed), { lines: proposed.facts.lines });
    expect(review.lines.cellTranches).toEqual([
      { qty: null },
      { qty: expect.objectContaining({ label: 'Low' }) },
    ]);
    expect(review.lines.itemTranches?.map((t) => t?.label ?? null)).toEqual([null, 'Low']);
    expect(review.lines.score).toBe(0.55);
  });

  it('diffs a list against its proposal under the field schema', () => {
    const values = { codes: ['E11', 'Z00'], lines: [proposed.facts.lines[1], proposed.facts.lines[0]] };
    const review = buildFormReview(spec, schema, ctxFor({}, proposed), values);
    expect(review.codes.changed).toBe(true);
    expect(review.codes.diff?.itemsChanged).toBe(1);
    expect(review.lines.changed).toBe(false);
  });

  it('counts a changed list once in review_changed and its items in review_items_changed', () => {
    const values = { name: 'Jon', codes: ['E11', 'Z00', 'Q11'], lines: [{ code: 'A2', qty: 5 }] };
    const facets = buildReviewFacets(schema, ctxFor({ name: 0.9 }, proposed), values);
    expect(facets).toMatchObject({
      [REVIEW_FACET_KEYS.OUTCOME]: 'corrected',
      [REVIEW_FACET_KEYS.CHANGED]: '2',
      [REVIEW_FACET_KEYS.ITEMS_CHANGED]: '4',
    });
  });

  it('leaves the facet set unchanged for a form with no list', () => {
    const plain = { 'x-lt-confidence': { facets: true }, properties: { name: { type: 'string' } } };
    const facets = buildReviewFacets(plain, ctxFor({ name: 0.4 }, { name: 'Jon' }), { name: 'John' });
    expect(Object.keys(facets!).sort()).toEqual(['review_changed', 'review_outcome', 'review_worst']);
  });

  it('sums item changes across the shown fields in the summary', () => {
    const values = { codes: ['x'], lines: [] };
    const review = buildFormReview(spec, schema, ctxFor({}, proposed), values);
    expect(summarizeReview(spec, review, ['codes', 'lines']).itemsChanged).toBe(4);
  });

  it('keeps each score with its own item when the reviewer replaces one in an unordered list', () => {
    const unordered = { 'x-lt-confidence': true, properties: { codes: { type: 'array', items: { type: 'string' }, 'x-lt-unordered': true } } };
    const unorderedSpec = readConfidenceSpec(unordered)!;
    const ctx = ctxFor({ codes: [0.97, 0.58] }, { codes: ['E11', 'I73'] });
    const review = buildFormReview(unorderedSpec, unordered, ctx, { codes: ['E11', 'Z00'] });
    expect(review.codes.itemTranches?.map((t) => t?.label ?? null)).toEqual([null, null]);
    const moved = buildFormReview(unorderedSpec, unordered, ctx, { codes: ['I73', 'E11'] });
    expect(moved.codes.itemTranches?.map((t) => t?.label ?? null)).toEqual(['Low', null]);
  });

  it('follows keyed rows: an added row has no cell scores, a moved row keeps its own', () => {
    const scores = { facts: { lines: [{ qty: 0.9 }, { qty: 0.55 }] } };
    const values = { lines: [{ code: 'A3', qty: 1 }, { code: 'A2', qty: 2 }] };
    const review = buildFormReview(spec, schema, ctxFor(scores, proposed), values);
    expect(review.lines.cellTranches?.[0]).toBeNull();
    expect(review.lines.cellTranches?.[1]).toMatchObject({ qty: { label: 'Low' } });
  });
});
