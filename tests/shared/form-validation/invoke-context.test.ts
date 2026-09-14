import { describe, it, expect } from 'vitest';

import { buildInvokeFormContext } from '../../../shared/form-validation/invoke-context';

// The invoke form context: metadata always present, lookup only when supplied.

describe('buildInvokeFormContext', () => {
  it('carries the envelope metadata and no lookup domain by default', () => {
    expect(buildInvokeFormContext({ source: 'dashboard' })).toEqual({ metadata: { source: 'dashboard' } });
    expect(buildInvokeFormContext({ source: 'dashboard' })).not.toHaveProperty('lookup');
  });

  it('absent metadata reads as an empty object', () => {
    expect(buildInvokeFormContext(null)).toEqual({ metadata: {} });
    expect(buildInvokeFormContext(undefined)).toEqual({ metadata: {} });
  });

  it('adds the lookup domain when resolved editions are supplied', () => {
    const lookup = { serials: { items: [{ value: 'sn-1', label: 'Printer 1' }] } };
    expect(buildInvokeFormContext({}, lookup)).toEqual({ metadata: {}, lookup });
  });

  it('a null lookup leaves the domain out', () => {
    expect(buildInvokeFormContext({}, null)).toEqual({ metadata: {} });
  });
});
