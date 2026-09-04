import { describe, it, expect, beforeEach } from 'vitest';
import {
  LINK_VAR_RE,
  makePlaceholder,
  getLinkVarValues,
  setLinkVarValue,
  substituteLinkVars,
  extractLinkVarNames,
} from '../link-vars';

const facetsUrl = (facets: Record<string, unknown>, extra = '') =>
  `/escalations/available?facets=${encodeURIComponent(JSON.stringify(facets))}${extra}`;

const facetsOf = (url: string): Record<string, unknown> | null => {
  const raw = new URL(url, 'http://local').searchParams.get('facets');
  return raw ? JSON.parse(raw) : null;
};

describe('placeholder syntax', () => {
  it('matches the whole-value {lt:name} form only', () => {
    expect(LINK_VAR_RE.test('{lt:facility}')).toBe(true);
    expect(LINK_VAR_RE.test('{lt:work_bench2}')).toBe(true);
    expect(LINK_VAR_RE.test('{facility}')).toBe(false);
    expect(LINK_VAR_RE.test('pre{lt:facility}')).toBe(false);
    expect(LINK_VAR_RE.test('{lt:facility}post')).toBe(false);
    expect(LINK_VAR_RE.test('{lt:has space}')).toBe(false);
    expect(LINK_VAR_RE.test('{lt:}')).toBe(false);
  });

  it('makePlaceholder round-trips through the regex', () => {
    const m = LINK_VAR_RE.exec(makePlaceholder('facility'));
    expect(m?.[1]).toBe('facility');
  });
});

describe('substituteLinkVars', () => {
  it('binds the device value', () => {
    const url = facetsUrl({ facility: '{lt:facility}' });
    const out = substituteLinkVars(url, { facility: 'soleful' }, {});
    expect(facetsOf(out)).toEqual({ facility: 'soleful' });
  });

  it('device value wins over the declared default', () => {
    const url = facetsUrl({ facility: '{lt:facility}' });
    const out = substituteLinkVars(url, { facility: 'soleful' }, { facility: 'main' });
    expect(facetsOf(out)).toEqual({ facility: 'soleful' });
  });

  it('falls back to the default when unbound', () => {
    const url = facetsUrl({ facility: '{lt:facility}' });
    const out = substituteLinkVars(url, {}, { facility: 'main' });
    expect(facetsOf(out)).toEqual({ facility: 'main' });
  });

  it('drops the facet when unbound with no default', () => {
    const url = facetsUrl({ facility: '{lt:facility}', station: 'st-1' });
    const out = substituteLinkVars(url, {}, {});
    expect(facetsOf(out)).toEqual({ station: 'st-1' });
  });

  it('removes the facets param entirely when it empties', () => {
    const url = facetsUrl({ facility: '{lt:facility}' }, '&status=all');
    const out = substituteLinkVars(url, {}, {});
    expect(out).not.toContain('facets');
    expect(out).toContain('status=all');
  });

  it('leaves literal values and other params untouched', () => {
    const url = facetsUrl({ facility: 'literal', n: 3 }, '&role=gluer');
    expect(substituteLinkVars(url, { facility: 'x' }, {})).toBe(url);
  });

  it('passes through URLs without facets, malformed facets, and non-object facets', () => {
    expect(substituteLinkVars('/escalations?role=gluer', { a: 'b' }, {})).toBe('/escalations?role=gluer');
    expect(substituteLinkVars('/e?facets=%7Bnope', { a: 'b' }, {})).toBe('/e?facets=%7Bnope');
    expect(substituteLinkVars('/e?facets=%5B1%5D', { a: 'b' }, {})).toBe('/e?facets=%5B1%5D');
  });

  it('substitutes multiple variables independently', () => {
    const url = facetsUrl({ facility: '{lt:facility}', bench: '{lt:bench}' });
    const out = substituteLinkVars(url, { facility: 'soleful' }, { bench: 'b-2' });
    expect(facetsOf(out)).toEqual({ facility: 'soleful', bench: 'b-2' });
  });
});

describe('extractLinkVarNames', () => {
  it('collects unique referenced names', () => {
    const url = facetsUrl({ a: '{lt:facility}', b: '{lt:facility}', c: '{lt:bench}', d: 'lit' });
    expect(extractLinkVarNames(url)).toEqual(['facility', 'bench']);
  });

  it('returns empty for non-templated and malformed URLs', () => {
    expect(extractLinkVarNames(facetsUrl({ a: 'lit' }))).toEqual([]);
    expect(extractLinkVarNames('/e?facets=%7Bnope')).toEqual([]);
    expect(extractLinkVarNames('/plain')).toEqual([]);
  });
});

describe('device store', () => {
  beforeEach(() => localStorage.clear());

  it('set, read, overwrite, and clear one binding', () => {
    setLinkVarValue('u1', 'facility', 'soleful');
    expect(getLinkVarValues('u1')).toEqual({ facility: 'soleful' });
    setLinkVarValue('u1', 'facility', 'main');
    expect(getLinkVarValues('u1')).toEqual({ facility: 'main' });
    setLinkVarValue('u1', 'facility', null);
    expect(getLinkVarValues('u1')).toEqual({});
    expect(localStorage.getItem('lt:station:link-vars:u1')).toBeNull();
  });

  it('empty string clears like null', () => {
    setLinkVarValue('u1', 'facility', 'soleful');
    setLinkVarValue('u1', 'facility', '');
    expect(getLinkVarValues('u1')).toEqual({});
  });

  it('keys are per user', () => {
    setLinkVarValue('u1', 'facility', 'soleful');
    setLinkVarValue('u2', 'facility', 'main');
    expect(getLinkVarValues('u1')).toEqual({ facility: 'soleful' });
    expect(getLinkVarValues('u2')).toEqual({ facility: 'main' });
  });

  it('tolerates corrupt storage', () => {
    localStorage.setItem('lt:station:link-vars:u1', 'not-json');
    expect(getLinkVarValues('u1')).toEqual({});
    localStorage.setItem('lt:station:link-vars:u1', JSON.stringify({ ok: 'yes', bad: 5 }));
    expect(getLinkVarValues('u1')).toEqual({ ok: 'yes' });
  });
});
