import { describe, it, expect, afterEach } from 'vitest';

import { labelTransportRegistry } from '../../../lib/labels/transports';

const transport = { formats: ['zpl' as const], send: async () => ({ accepted: true }) };

afterEach(() => labelTransportRegistry.clear());

describe('labelTransportRegistry', () => {
  it('throws for a name with no transport', () => {
    expect(() => labelTransportRegistry.get('thermal')).toThrow(/No label transport/);
  });

  it('registers, lists and returns transports by name', () => {
    labelTransportRegistry.register('thermal', transport);
    expect(labelTransportRegistry.has('thermal')).toBe(true);
    expect(labelTransportRegistry.list()).toEqual([{ name: 'thermal', formats: ['zpl'] }]);
    expect(labelTransportRegistry.get('thermal')).toBe(transport);
  });

  it('refuses a malformed name', () => {
    expect(() => labelTransportRegistry.register('Thermal Room', transport)).toThrow(/lowercase/);
  });
});
