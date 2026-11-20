import { describe, it, expect } from 'vitest';

import {
  applyTransforms,
  declaredTypes,
  isEditableListSchema,
  isNullableType,
  itemColumnOrder,
  listControlOf,
  readListSpec,
  readLocator,
  readTransforms,
  readWidth,
  singleType,
} from '../../../shared/form-validation';

const CODES = { type: ['array', 'null'], items: { type: 'string' } };
const LINES = {
  type: 'array',
  items: { type: 'object', 'x-lt-order': ['qty', 'code'], properties: { code: { type: 'string' }, qty: { type: 'integer' }, note: { type: 'string' } } },
};

describe('list schema reads', () => {
  it('reads a nullable type as its one concrete type', () => {
    expect(declaredTypes(CODES)).toEqual(['array']);
    expect(singleType(CODES)).toBe('array');
    expect(isNullableType(CODES)).toBe(true);
    expect(isNullableType({ type: 'array' })).toBe(false);
    expect(singleType({ type: ['string', 'number'] })).toBeUndefined();
  });

  it('chooses the control by widget, then options, then item shape', () => {
    expect(listControlOf(CODES)).toBe('pills');
    expect(listControlOf(LINES)).toBe('rows');
    expect(listControlOf({ ...CODES, 'x-lt-widget': 'json' })).toBe('json');
    expect(listControlOf({ type: 'array', items: { type: 'string' }, 'x-lt-options': ['a', 'b'] })).toBe('chips');
    expect(listControlOf({ type: 'array', items: { type: 'string' }, 'x-lt-options': ['a', 'b'] }, 15)).toBe('picker');
    expect(listControlOf({ type: 'array', 'x-lt-options': ['a'], 'x-lt-display': 'picker' })).toBe('picker');
    expect(listControlOf({ type: 'array' })).toBeNull();
    expect(listControlOf({ type: 'string' })).toBeNull();
  });

  it('leaves a scan sink and a readOnly list out of the editable controls', () => {
    const sink = { ...CODES, 'x-lt-scan': { schemes: [16] } };
    expect(listControlOf(sink)).toBeNull();
    expect(isEditableListSchema(CODES)).toBe(true);
    expect(isEditableListSchema({ ...CODES, readOnly: true })).toBe(false);
  });

  it('orders columns by x-lt-order, then declaration', () => {
    expect(itemColumnOrder(LINES.items)).toEqual(['qty', 'code', 'note']);
  });

  it('always trims and applies named transforms in order', () => {
    expect(readTransforms({ 'x-lt-transform': 'uppercase' })).toEqual(['trim', 'uppercase']);
    expect(readTransforms({ 'x-lt-transform': ['bogus', 'lowercase'] })).toEqual(['trim', 'lowercase']);
    expect(applyTransforms('  e11.65 ', readTransforms({ 'x-lt-transform': 'uppercase' }))).toBe('E11.65');
  });

  it('reads presentation tokens with defaults', () => {
    expect(readListSpec({})).toMatchObject({ sortable: false, unordered: false, collapseAfter: 3 });
    expect(readListSpec({ 'x-lt-collapse-after': 5, 'x-lt-item-key': 'code', 'x-lt-sortable': true }))
      .toMatchObject({ collapseAfter: 5, itemKey: 'code', sortable: true });
    expect(readListSpec({ 'x-lt-collapse-after': 0 }).collapseAfter).toBe(3);
    expect(readWidth({ 'x-lt-width': 'sm' })).toBe('sm');
    expect(readWidth({ 'x-lt-width': 'huge' })).toBeUndefined();
  });

  it('reads a locator only when it names a page or a quote', () => {
    expect(readLocator({ 'x-lt-locate': { file: 'doc', page: 'page', quote: 'quote' } })).toEqual({ file: 'doc', page: 'page', quote: 'quote' });
    expect(readLocator({ items: { 'x-lt-locate': { quote: 'q' } } })).toMatchObject({ quote: 'q' });
    expect(readLocator({ 'x-lt-locate': { file: 'doc' } })).toBeNull();
    expect(readLocator({})).toBeNull();
  });
});

describe('listShortcutsMarkdown', () => {
  it('lists shortcuts for the controls a form uses and nothing for a form without lists', async () => {
    const { listShortcutsMarkdown } = await import('../../../shared/form-validation');
    expect(listShortcutsMarkdown({ properties: { n: { type: 'string' } } })).toBeNull();
    const pills = listShortcutsMarkdown({ properties: { c: CODES } })!;
    expect(pills).toContain('**Pills**');
    expect(pills).not.toContain('**Rows**');
    const both = listShortcutsMarkdown({ properties: { c: CODES, l: LINES } })!;
    expect(both).toContain('**Rows**');
    expect(listShortcutsMarkdown({ properties: { c: { ...CODES, readOnly: true } } })).toBeNull();
  });
});
