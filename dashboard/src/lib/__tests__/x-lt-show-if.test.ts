import { describe, it, expect } from 'vitest';
import { evaluateShowIf, type ShowIfContext } from '../x-lt-show-if';

const ctx: ShowIfContext = {
  metadata: { crew_pill: true, item_type: 'standard', nested: { level: 'deep' } },
  payload: { action: 'process' },
  envelope: { session: 'abc' },
  escalation: { role: 'crew-worker', status: 'pending' },
  resolver: null,
};

describe('evaluateShowIf', () => {
  it('returns true when condition is undefined', () => {
    expect(evaluateShowIf(undefined, ctx)).toBe(true);
  });

  it('returns true when condition is empty string', () => {
    expect(evaluateShowIf('', ctx)).toBe(true);
  });

  it('returns true when condition is not a string', () => {
    expect(evaluateShowIf(42, ctx)).toBe(true);
    expect(evaluateShowIf(null, ctx)).toBe(true);
    expect(evaluateShowIf({ path: 'metadata.crew_pill' }, ctx)).toBe(true);
  });

  it('returns true when ctx is null', () => {
    expect(evaluateShowIf('metadata.crew_pill', null)).toBe(true);
  });

  it('returns true when ctx is undefined', () => {
    expect(evaluateShowIf('metadata.crew_pill', undefined)).toBe(true);
  });

  it('returns true when the value is truthy', () => {
    expect(evaluateShowIf('metadata.crew_pill', ctx)).toBe(true);
  });

  it('returns false when the value is absent', () => {
    expect(evaluateShowIf('metadata.missing_key', ctx)).toBe(false);
  });

  it('negation: returns false when value is truthy', () => {
    expect(evaluateShowIf('!metadata.crew_pill', ctx)).toBe(false);
  });

  it('negation: returns true when value is absent', () => {
    expect(evaluateShowIf('!metadata.missing_key', ctx)).toBe(true);
  });

  it('resolves nested paths', () => {
    expect(evaluateShowIf('metadata.nested.level', ctx)).toBe(true);
    expect(evaluateShowIf('metadata.nested.gone', ctx)).toBe(false);
  });

  it('resolves across domains', () => {
    expect(evaluateShowIf('payload.action', ctx)).toBe(true);
    expect(evaluateShowIf('envelope.session', ctx)).toBe(true);
    expect(evaluateShowIf('escalation.role', ctx)).toBe(true);
    expect(evaluateShowIf('escalation.missing', ctx)).toBe(false);
  });

  it('returns true for an unknown domain (safe default)', () => {
    expect(evaluateShowIf('unknown_domain.foo', ctx)).toBe(true);
  });

  it('treats null resolver domain as falsy', () => {
    expect(evaluateShowIf('resolver.notes', ctx)).toBe(false);
    expect(evaluateShowIf('!resolver.notes', ctx)).toBe(true);
  });

  it('handles false boolean value as falsy', () => {
    const c: ShowIfContext = { metadata: { flag: false } };
    expect(evaluateShowIf('metadata.flag', c)).toBe(false);
    expect(evaluateShowIf('!metadata.flag', c)).toBe(true);
  });

  it('handles empty string value as falsy', () => {
    const c: ShowIfContext = { metadata: { label: '' } };
    expect(evaluateShowIf('metadata.label', c)).toBe(false);
  });

  it('handles zero as falsy', () => {
    const c: ShowIfContext = { metadata: { count: 0 } };
    expect(evaluateShowIf('metadata.count', c)).toBe(false);
  });

  it('handles non-zero number as truthy', () => {
    const c: ShowIfContext = { metadata: { count: 1 } };
    expect(evaluateShowIf('metadata.count', c)).toBe(true);
  });
});
