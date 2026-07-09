import { describe, it, expect } from 'vitest';

import {
  requiredCapabilities,
  normalizeRegistration,
  twinAdvertFacets,
  claimFacetsForGroup,
} from '../../examples/workflows/printer-twin/policy';

// Capability matching is metadata containment: demand carries only the
// capabilities it REQUIRES; the broker's set-claim intersects on those keys.

describe('requiredCapabilities', () => {
  it('keeps only capability keys explicitly true', () => {
    expect(requiredCapabilities({ xl: true, pdac: false, soft: true, filament: 'pla' }))
      .toEqual({ xl: true, soft: true });
  });

  it('an order with no requirements matches any printer', () => {
    expect(requiredCapabilities({ filament: 'pla' })).toEqual({});
  });

  it('ignores truthy non-boolean values (no string coercion into the claim query)', () => {
    expect(requiredCapabilities({ xl: 'true', pdac: 1 })).toEqual({});
  });
});

describe('normalizeRegistration', () => {
  it('coerces checkbox strings to booleans and preserves identity fields', () => {
    const reg = normalizeRegistration({
      serialNumber: 'SN-100', model: 'M-1', manufactureDate: '2026-01-15',
      filament: 'pla', certifications: 'ce', xl: 'true', pdac: false, soft: true,
    });
    expect(reg.xl).toBe(true);
    expect(reg.pdac).toBe(false);
    expect(reg.soft).toBe(true);
    expect(reg.serialNumber).toBe('SN-100');
  });

  it('missing fields become safe empties, never undefined identity facets', () => {
    const reg = normalizeRegistration({});
    expect(reg.serialNumber).toBe('');
    expect(reg.xl).toBe(false);
    expect(reg.notes).toBeUndefined();
  });
});

describe('twinAdvertFacets', () => {
  it('stamps identity plus the FULL capability map (both polarities queryable)', () => {
    const facets = twinAdvertFacets('printer-01', {
      serialNumber: 'SN-100', model: 'M-1', manufactureDate: '2026-01-15',
      filament: 'pla', certifications: '', xl: true, pdac: false, soft: false,
    });
    expect(facets).toMatchObject({
      printerId: 'printer-01', serialNumber: 'SN-100', model: 'M-1',
      filament: 'pla', xl: true, pdac: false, soft: false,
    });
  });
});

describe('claimFacetsForGroup', () => {
  it('claims ready printers on filament plus only the required capabilities', () => {
    expect(claimFacetsForGroup({ filament: 'tpu', soft: true, xl: false }))
      .toEqual({ state: 'ready', filament: 'tpu', soft: true });
  });
});
