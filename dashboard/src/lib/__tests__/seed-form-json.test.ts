import { describe, it, expect } from 'vitest';
import { seedFormJson } from '../seed-form-json';

describe('seedFormJson', () => {
  it('seeds every field to its prefill, its default, or the zero value: {} for objects, empty text otherwise', () => {
    const seeded = JSON.parse(seedFormJson({
      properties: {
        name: { type: 'string' },
        copies: { type: 'number' },
        force: { type: 'boolean' },
        roles: { type: 'array' },
        mix: { type: 'object' },
        withDefault: { type: 'number', default: 3 },
      },
    }));
    expect(seeded).toMatchObject({ name: '', copies: '', force: '', roles: '', mix: {}, withDefault: 3 });
    expect(seeded._form_schema.properties.mix.type).toBe('object');
  });

  it('a prefilled payload wins over defaults through x-lt-bind', () => {
    const seeded = JSON.parse(seedFormJson(
      { properties: { serial: { type: 'string', 'x-lt-bind': 'printer.serialNumber', default: 'none' } } },
      { printer: { serialNumber: 'sn-1' } },
    ));
    expect(seeded.serial).toBe('sn-1');
  });
});
