import { describe, it, expect } from 'vitest';
import { identifierToTitle } from '../identifier-label';

describe('identifierToTitle', () => {
  it('splits camelCase into Title Case words', () => {
    expect(identifierToTitle('fleetTools')).toBe('Fleet Tools');
    expect(identifierToTitle('reviewContent')).toBe('Review Content');
    expect(identifierToTitle('basicEcho')).toBe('Basic Echo');
  });

  it('handles snake, kebab, digits, and acronym runs', () => {
    expect(identifierToTitle('print_order')).toBe('Print Order');
    expect(identifierToTitle('printer-health-check')).toBe('Printer Health Check');
    expect(identifierToTitle('relPlateWorkflow2')).toBe('Rel Plate Workflow 2');
    expect(identifierToTitle('printUPCLabel')).toBe('Print UPC Label');
  });
});
