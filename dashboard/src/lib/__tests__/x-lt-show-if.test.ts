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

describe('evaluateShowIf — equality forms', () => {
  const eqCtx: ShowIfContext = {
    metadata: { station: 'DRAFT', count: 3, live: true },
    payload: null,
    envelope: null,
    escalation: null,
    resolver: { designatedStation: 'DRAFT', notes: '' },
  };

  it('= matches the string value', () => {
    expect(evaluateShowIf('resolver.designatedStation=DRAFT', eqCtx)).toBe(true);
    expect(evaluateShowIf('resolver.designatedStation=PRINT', eqCtx)).toBe(false);
  });

  it('!= is the inverse', () => {
    expect(evaluateShowIf('resolver.designatedStation!=PRINT', eqCtx)).toBe(true);
    expect(evaluateShowIf('resolver.designatedStation!=DRAFT', eqCtx)).toBe(false);
  });

  it('numbers and booleans compare via their string form', () => {
    expect(evaluateShowIf('metadata.count=3', eqCtx)).toBe(true);
    expect(evaluateShowIf('metadata.live=true', eqCtx)).toBe(true);
    expect(evaluateShowIf('metadata.count=4', eqCtx)).toBe(false);
  });

  it('an absent value compares as empty string', () => {
    expect(evaluateShowIf('metadata.missing=X', eqCtx)).toBe(false);
    expect(evaluateShowIf('metadata.missing!=X', eqCtx)).toBe(true);
    expect(evaluateShowIf('metadata.missing=', eqCtx)).toBe(true); // '' === ''
  });

  it('an empty string value equals the empty expected', () => {
    expect(evaluateShowIf('resolver.notes=', eqCtx)).toBe(true);
    expect(evaluateShowIf('resolver.notes!=', eqCtx)).toBe(false);
  });

  it('expected value is the raw remainder — spaces trimmed, no quoting', () => {
    expect(evaluateShowIf('resolver.designatedStation= DRAFT ', eqCtx)).toBe(true);
  });

  it('leading ! composes with equality (negated match)', () => {
    expect(evaluateShowIf('!resolver.designatedStation=DRAFT', eqCtx)).toBe(false);
    expect(evaluateShowIf('!resolver.designatedStation=PRINT', eqCtx)).toBe(true);
  });

  it('unknown domain with equality stays the safe default (show)', () => {
    expect(evaluateShowIf('bogus.path=X', eqCtx)).toBe(true);
  });

  it('truthy forms are untouched by the extension', () => {
    expect(evaluateShowIf('metadata.live', eqCtx)).toBe(true);
    expect(evaluateShowIf('!metadata.missing', eqCtx)).toBe(true);
  });
});
