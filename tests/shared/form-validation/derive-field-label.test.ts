import { describe, it, expect } from 'vitest';

import { deriveFieldLabel } from '../../../shared/form-validation';

describe('deriveFieldLabel', () => {
  it('prefers the schema title keyword', () => {
    expect(deriveFieldLabel('LEFTQUANTITY', { title: 'Left Quantity' })).toBe('Left Quantity');
    expect(deriveFieldLabel('notes', { title: 'Reviewer Notes' })).toBe('Reviewer Notes');
  });

  it('trims the title and ignores empty ones', () => {
    expect(deriveFieldLabel('notes', { title: '  Reviewer Notes  ' })).toBe('Reviewer Notes');
    expect(deriveFieldLabel('order_id', { title: '   ' })).toBe('Order Id');
  });

  it('ignores non-string titles', () => {
    expect(deriveFieldLabel('order_id', { title: 42 as unknown as string })).toBe('Order Id');
  });

  it('title-cases snake_case keys', () => {
    expect(deriveFieldLabel('left_quantity')).toBe('Left Quantity');
    expect(deriveFieldLabel('customer_name')).toBe('Customer Name');
  });

  it('title-cases kebab-case keys', () => {
    expect(deriveFieldLabel('shoe-size')).toBe('Shoe Size');
  });

  it('keeps all-caps tokens inside multi-word keys', () => {
    expect(deriveFieldLabel('PO_number')).toBe('PO Number');
    expect(deriveFieldLabel('order_ID')).toBe('Order ID');
  });

  it('passes single-token keys through unchanged', () => {
    expect(deriveFieldLabel('PO')).toBe('PO');
    expect(deriveFieldLabel('LEFTQUANTITY')).toBe('LEFTQUANTITY');
    expect(deriveFieldLabel('notes')).toBe('notes');
  });

  it('collapses repeated separators', () => {
    expect(deriveFieldLabel('left__quantity')).toBe('Left Quantity');
    expect(deriveFieldLabel('_internal_key')).toBe('Internal Key');
  });
});
