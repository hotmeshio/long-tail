import { describe, it, expect } from 'vitest';
import { seedFormJson } from '../seed-form-json';

const schema = {
  properties: {
    serialNumber: { type: 'string', 'x-lt-bind': 'printer.serialNumber' },
    copies: { type: 'number', default: 1 },
    checks: { type: 'object' },
    note: { type: 'string' },
  },
};

describe('seedFormJson', () => {
  it('carries the schema as the sidecar and seeds defaults and typed zero values', () => {
    const seeded = JSON.parse(seedFormJson(schema));
    expect(seeded._form_schema).toEqual(schema);
    expect(seeded.copies).toBe(1);
    expect(seeded.checks).toEqual({});
    expect(seeded.note).toBe('');
  });

  it('a prefill payload wins over defaults, read through x-lt-bind', () => {
    const seeded = JSON.parse(seedFormJson(schema, { printer: { serialNumber: 'sn-1' }, copies: 3 }));
    expect(seeded.serialNumber).toBe('sn-1');
    expect(seeded.copies).toBe(3);
  });
});
