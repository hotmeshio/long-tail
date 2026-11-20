import { describe, it, expect } from 'vitest';
import {
  appendItem, dropEmptyRows, duplicateAt, indexOfEqual, isEmptyRow, keyWords, moveItem, newRow, pasteGrid, pillValue, removeAt, replaceAt, splitPaste,
} from '../list-ops';

const LINES = { items: { type: 'object', properties: { code: { type: 'string' }, qty: { type: 'integer', default: 1 }, note: { type: 'string' } } } };

describe('list value operations', () => {
  it('append, replace and remove leave the input untouched', () => {
    const base = ['a', 'b'];
    expect(appendItem(base, 'c')).toEqual(['a', 'b', 'c']);
    expect(replaceAt(base, 1, 'x')).toEqual(['a', 'x']);
    expect(removeAt(base, 0)).toEqual(['b']);
    expect(base).toEqual(['a', 'b']);
    expect(appendItem(null, 'a')).toEqual(['a']);
  });

  it('moves within bounds and ignores moves past either end', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('duplicates a row as an independent copy just after it', () => {
    const rows = [{ code: 'a' }, { code: 'b' }];
    const next = duplicateAt(rows, 0) as Array<{ code: string }>;
    expect(next.map((r) => r.code)).toEqual(['a', 'a', 'b']);
    next[1].code = 'z';
    expect(rows[0].code).toBe('a');
  });

  it('starts a row from property defaults only', () => {
    expect(newRow(LINES.items)).toEqual({ qty: 1 });
  });

  it('drops rows empty in every declared property, keeping rows with any value', () => {
    expect(isEmptyRow({ code: '', qty: null, extra: 'kept' }, LINES.items)).toBe(true);
    const rows = [{ code: 'a' }, { code: '', qty: '' }, { qty: 0 }];
    expect(dropEmptyRows(rows as any, LINES)).toEqual([{ code: 'a' }, { qty: 0 }]);
    expect(dropEmptyRows(['a', ''] as any, { items: { type: 'string' } })).toEqual(['a', '']);
    expect(dropEmptyRows(null, LINES)).toBeNull();
  });

  it('commits pill text through trim, named transforms and numeric items', () => {
    expect(pillValue('  e11.65 ', { items: { type: 'string', 'x-lt-transform': 'uppercase' } })).toBe('E11.65');
    expect(pillValue(' 42 ', { items: { type: 'integer' } })).toBe(42);
    expect(pillValue('abc', { items: { type: 'integer' } })).toBe('abc');
  });

  it('splits a paste on commas, semicolons, tabs and lines', () => {
    expect(splitPaste('E11.65, E11.42; I73.9')).toEqual(['E11.65', 'E11.42', 'I73.9']);
    expect(splitPaste('a\nb\r\n\nc')).toEqual(['a', 'b', 'c']);
  });

  it('finds an equal item by the form comparison, so "42" equals 42', () => {
    expect(indexOfEqual([1, '42'], 42)).toBe(1);
    expect(indexOfEqual(['a'], 'b')).toBe(-1);
  });

  it('pastes a grid from the focused cell onward, adding rows up to the maximum', () => {
    const cols = ['code', 'qty', 'note'];
    const rows = pasteGrid([{ code: 'a', qty: 1 }], { row: 0, col: 1 }, '5\tn1\n7\tn2\n9', cols, LINES.items, 2);
    expect(rows).toEqual([{ code: 'a', qty: 5, note: 'n1' }, { qty: 7, note: 'n2' }]);
  });

  it('reads item keys as words', () => {
    expect(keyWords('source_section')).toBe('Source section');
    expect(keyWords('preUlcerative')).toBe('Pre ulcerative');
  });
});
