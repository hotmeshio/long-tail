import { describe, it, expect } from 'vitest';

import { eligiblePrinterClasses, canServe } from '../../examples/workflows/print-routing/policy/capability';

// Soft capability: the funnel's second stage. A standard order overflows to a larger
// xl printer; an xl order is a hard fit (xl-only). The role wall is still the hard cull.

describe('eligiblePrinterClasses', () => {
  it('a standard order prefers a standard printer, then overflows to xl', () => {
    expect(eligiblePrinterClasses('standard')).toEqual(['standard', 'xl']);
  });

  it('an xl order is xl-only — a hard physical fit', () => {
    expect(eligiblePrinterClasses('xl')).toEqual(['xl']);
  });
});

describe('canServe', () => {
  it('requires matching filament', () => {
    expect(canServe({ filament: 'pla', sizeClass: 'xl' }, { filament: 'petg', sizeClass: 'standard' })).toBe(false);
  });

  it('an xl printer serves a standard order (overflow)', () => {
    expect(canServe({ filament: 'pla', sizeClass: 'xl' }, { filament: 'pla', sizeClass: 'standard' })).toBe(true);
  });

  it('a standard printer cannot serve an xl order', () => {
    expect(canServe({ filament: 'pla', sizeClass: 'standard' }, { filament: 'pla', sizeClass: 'xl' })).toBe(false);
  });

  it('a standard printer serves a standard order', () => {
    expect(canServe({ filament: 'pla', sizeClass: 'standard' }, { filament: 'pla', sizeClass: 'standard' })).toBe(true);
  });
});
