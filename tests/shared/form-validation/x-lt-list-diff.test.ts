import { describe, it, expect } from 'vitest';

import { changedCells, diffList, differsFromProposal } from '../../../shared/form-validation';

const CODES = { type: ['array', 'null'], items: { type: 'string' } };
const LINES = {
  type: 'array',
  'x-lt-item-key': 'code',
  items: { type: 'object', properties: { code: { type: 'string' }, qty: { type: 'integer' } } },
};

describe('diffList by position', () => {
  it('marks an edit, an addition and a removal', () => {
    const diff = diffList(['E11', 'I73'], ['E11', 'I99', 'Z00'], CODES);
    expect(diff.marks.map((m) => m.kind)).toEqual(['same', 'edited', 'added']);
    expect(diff.marks[1].proposed).toBe('I73');
    expect(diff.itemsChanged).toBe(2);
    const shrunk = diffList(['E11', 'I73'], ['E11'], CODES);
    expect(shrunk.removed).toEqual([{ item: 'I73', before: 1 }]);
    expect(shrunk.itemsChanged).toBe(1);
  });

  it('counts a reorder as edits without a key or unordered flag', () => {
    expect(diffList(['a', 'b'], ['b', 'a'], CODES).changed).toBe(true);
  });

  it('compares scalars the way answers compare: trimmed, "42" equals 42', () => {
    expect(diffList([42, ' x '], ['42', 'x'], CODES).changed).toBe(false);
  });

  it('treats null as not stated: null against [] is a change, null against null is not', () => {
    expect(diffList(null, [], CODES)).toMatchObject({ changed: true, itemsChanged: 0 });
    expect(diffList(null, null, CODES).changed).toBe(false);
    expect(diffList([], [], CODES).changed).toBe(false);
  });
});

describe('diffList unordered and keyed', () => {
  it('ignores a reorder when the list is unordered', () => {
    const schema = { ...CODES, 'x-lt-unordered': true };
    expect(diffList(['a', 'b'], ['b', 'a'], schema).changed).toBe(false);
    const diff = diffList(['a', 'b'], ['b', 'c'], schema);
    expect(diff.marks.map((m) => m.kind)).toEqual(['same', 'added']);
    expect(diff.removed.map((r) => r.item)).toEqual(['a']);
  });

  it('matches rows by key so a reorder alone is not a change, and names the edited cells', () => {
    const proposed = [{ code: 'A1', qty: 1 }, { code: 'A2', qty: 2 }];
    expect(diffList(proposed, [proposed[1], proposed[0]], LINES).changed).toBe(false);
    const diff = diffList(proposed, [{ code: 'A2', qty: 5 }, { code: 'A3', qty: 1 }], LINES);
    expect(diff.marks).toMatchObject([{ kind: 'edited', cells: ['qty'] }, { kind: 'added' }]);
    expect(diff.removed).toEqual([{ item: proposed[0], before: 0 }]);
    expect(diff.itemsChanged).toBe(3);
  });

  it('notices a changed attribute the schema does not declare', () => {
    expect(changedCells({ code: 'A1', foot: 'left' }, { code: 'A1', foot: 'right' })).toEqual(['foot']);
  });
});

describe('differsFromProposal with a schema', () => {
  it('uses the list rules when given the field schema and the scalar rule otherwise', () => {
    expect(differsFromProposal(['a', 'b'], ['b', 'a'], { ...CODES, 'x-lt-unordered': true })).toBe(false);
    expect(differsFromProposal(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(differsFromProposal('Jon', ' Jon ')).toBe(false);
    expect(differsFromProposal(null, [], CODES)).toBe(true);
  });
});
