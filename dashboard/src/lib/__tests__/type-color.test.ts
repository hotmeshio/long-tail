import { describe, it, expect } from 'vitest';

import { typeColor } from '../type-color';

describe('typeColor', () => {
  it('returns the same color for the same input', () => {
    const first = typeColor('workflow');
    const second = typeColor('workflow');
    expect(first).toEqual(second);
  });

  it('produces different colors for different inputs', () => {
    const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
    const colors = names.map((n) => typeColor(n));
    const uniqueBgs = new Set(colors.map((c) => c.bg));
    expect(uniqueBgs.size).toBeGreaterThanOrEqual(2);
  });

  it('returns an object with text and bg string properties', () => {
    const result = typeColor('test');
    expect(typeof result.text).toBe('string');
    expect(typeof result.bg).toBe('string');
  });

  it('text property is a Tailwind text color class', () => {
    const { text } = typeColor('mytype');
    expect(text).toMatch(/^text-[a-z]+-\d{3}$/);
  });

  it('bg property is a Tailwind bg color class', () => {
    const { bg } = typeColor('mytype');
    expect(bg).toMatch(/^bg-[a-z]+-\d{3}\/\[[\d.]+]$/);
  });
});
