import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIDENCE_TRANCHES,
  buildFormReview,
  differsFromProposal,
  readConfidenceSpec,
  summarizeReview,
  trancheFor,
} from '../../../shared/form-validation/x-lt-confidence';

const TRANCHES = [
  { below: 0.9, label: 'Check', tone: 'warning' },
  { below: 0.6, label: 'Low', tone: 'error' },
];

describe('readConfidenceSpec', () => {
  it('reads tranches in threshold order with the default paths', () => {
    const spec = readConfidenceSpec({ 'x-lt-confidence': { tranches: TRANCHES } });
    expect(spec).toEqual({
      scores: 'envelope.confidence',
      proposed: 'envelope.formDefaults',
      tranches: [
        { below: 0.6, label: 'Low', tone: 'error' },
        { below: 0.9, label: 'Check', tone: 'warning' },
      ],
      facets: false,
    });
  });

  it('reads the facets opt-in only as literal true', () => {
    expect(readConfidenceSpec({ 'x-lt-confidence': { facets: true } })!.facets).toBe(true);
    expect(readConfidenceSpec({ 'x-lt-confidence': { facets: 'yes' } })!.facets).toBe(false);
    expect(readConfidenceSpec({ 'x-lt-confidence': true })!.facets).toBe(false);
  });

  it('takes true as the default tranches and honors other paths', () => {
    expect(readConfidenceSpec({ 'x-lt-confidence': true })!.tranches).toEqual(DEFAULT_CONFIDENCE_TRANCHES);
    expect(readConfidenceSpec({ 'x-lt-confidence': { scores: 'payload.scores', proposed: 'payload.extracted' } }))
      .toMatchObject({ scores: 'payload.scores', proposed: 'payload.extracted' });
  });

  it('drops malformed tranches and duplicate thresholds; absent means none', () => {
    const spec = readConfidenceSpec({ 'x-lt-confidence': { tranches: [
      { below: 0, label: 'Zero' }, { below: 1.5, label: 'Over' }, { below: 0.5 }, { below: 0.5, label: 'Half', tone: 'nope' },
      { below: 0.5, label: 'Again' },
    ] } })!;
    expect(spec.tranches).toEqual([{ below: 0.5, label: 'Half', tone: 'warning' }]);
    expect(readConfidenceSpec({})).toBeNull();
    expect(readConfidenceSpec(null)).toBeNull();
  });
});

describe('trancheFor', () => {
  const spec = readConfidenceSpec({ 'x-lt-confidence': { tranches: TRANCHES } })!;
  it('places a score in the first tranche it is under; at a threshold it moves up', () => {
    expect(trancheFor(spec.tranches, 0.2)?.label).toBe('Low');
    expect(trancheFor(spec.tranches, 0.6)?.label).toBe('Check');
    expect(trancheFor(spec.tranches, 0.9)).toBeNull();
  });
});

describe('differsFromProposal', () => {
  it('compares answers, not representations', () => {
    expect(differsFromProposal('42', 42)).toBe(false);
    expect(differsFromProposal(null, '')).toBe(false);
    expect(differsFromProposal({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
    expect(differsFromProposal('Jon', 'John')).toBe(true);
    expect(differsFromProposal(['a'], ['a', 'b'])).toBe(true);
  });

  it('treats whitespace-only edits as unchanged, in nested values too', () => {
    expect(differsFromProposal('41 Harbor Lane', ' 41  Harbor\tLane ')).toBe(false);
    expect(differsFromProposal('', '   ')).toBe(false);
    expect(differsFromProposal({ street: 'A St' }, { street: 'A  St ' })).toBe(false);
    expect(differsFromProposal('41 Harbor Lane', '41 Harbour Lane')).toBe(true);
  });
});

describe('buildFormReview', () => {
  const schema = {
    'x-lt-confidence': { tranches: TRANCHES },
    properties: {
      first: { type: 'string' },
      plan: { type: 'string', 'x-lt-bind': 'coverage.plan' },
      sure: { type: 'string' },
      notes: { type: 'string', 'x-lt-confidence': false },
      doc: { type: 'string', 'x-lt-widget': 'document' },
      blank: { type: 'string' },
    },
  };
  const ctx = {
    envelope: {
      formDefaults: { first: 'Jon', coverage: { plan: 'PPO' }, sure: 'yes', notes: 'n' },
      confidence: { first: 0.4, coverage: { plan: 0.7 }, sure: 0.99, notes: 0.1, doc: 0.1 },
    },
  };
  const spec = readConfidenceSpec(schema)!;

  it('scores, tranches and diffs each covered field through its bind path', () => {
    const review = buildFormReview(spec, schema, ctx, { first: 'John', plan: 'PPO', sure: 'yes', notes: 'x' });
    expect(review.first).toMatchObject({ score: 0.4, tranche: { label: 'Low' }, proposed: 'Jon', changed: true });
    expect(review.plan).toMatchObject({ score: 0.7, tranche: { label: 'Check' }, proposed: 'PPO', changed: false });
    expect(review.sure).toMatchObject({ score: 0.99, changed: false });
    expect(review.sure.tranche).toBeUndefined();
    expect(review.notes).toBeUndefined();
    expect(review.doc).toBeUndefined();
    expect(review.blank).toBeUndefined();
  });

  it('diffs a submitted payload mapped back to form shape, after the fact', () => {
    const review = buildFormReview(spec, schema, ctx, { first: 'Jon', plan: 'HMO', sure: 'yes' });
    expect(review.plan.changed).toBe(true);
    expect(review.first.changed).toBe(false);
  });

  it('clamps scores into [0, 1] and ignores non-numbers', () => {
    const review = buildFormReview(spec, schema, { envelope: { confidence: { first: 7, sure: 'high' } } }, {});
    expect(review.first.score).toBe(1);
    expect(review.sure).toBeUndefined();
  });

  it('summarizes the shown fields per tranche and the edits', () => {
    const review = buildFormReview(spec, schema, ctx, { first: 'John', plan: 'PPO', sure: 'yes' });
    const summary = summarizeReview(spec, review, ['plan', 'first', 'sure']);
    expect(summary.tranches.map((t) => [t.tranche.label, t.fields])).toEqual([['Low', ['first']], ['Check', ['plan']]]);
    expect(summary.changed).toEqual(['first']);
    expect(summarizeReview(spec, review, ['sure']).changed).toEqual([]);
  });
});
