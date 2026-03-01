import { describe, it, expect } from 'vitest';
import { splitCsv, safeParseJson } from '../parse';

describe('splitCsv', () => {
  it('splits comma-separated values', () => {
    expect(splitCsv('a, b, c')).toEqual(['a', 'b', 'c']);
  });

  it('trims whitespace', () => {
    expect(splitCsv('  foo ,  bar  ')).toEqual(['foo', 'bar']);
  });

  it('filters empty strings', () => {
    expect(splitCsv('a,, b,')).toEqual(['a', 'b']);
  });

  it('handles empty input', () => {
    expect(splitCsv('')).toEqual([]);
  });

  it('handles single value', () => {
    expect(splitCsv('single')).toEqual(['single']);
  });
});

describe('safeParseJson', () => {
  it('parses valid JSON object', () => {
    const result = safeParseJson('{"a":1}');
    expect(result).toEqual({ ok: true, data: { a: 1 } });
  });

  it('parses valid JSON array', () => {
    const result = safeParseJson('[1,2,3]');
    expect(result).toEqual({ ok: true, data: [1, 2, 3] });
  });

  it('returns error for invalid JSON', () => {
    const result = safeParseJson('{bad}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
  });

  it('returns error for empty string', () => {
    const result = safeParseJson('');
    expect(result.ok).toBe(false);
  });
});
