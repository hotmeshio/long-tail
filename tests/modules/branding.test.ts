import { describe, it, expect, beforeEach } from 'vitest';

import { configureBranding, getBranding, getCustomCss } from '../../modules/branding';

const MIDNIGHT = {
  id: 'midnight',
  label: 'Midnight',
  swatch: '#0B1220',
  dark: true,
  css: "[data-theme='midnight'] { --lt-surface: 11 18 32; }",
};

beforeEach(() => {
  // Module-global state — reset to defaults between tests.
  configureBranding({ appName: 'LongTail', customCss: '', themes: [] });
});

describe('configureBranding / getBranding', () => {
  it('defaults to LongTail with no themes', () => {
    expect(getBranding()).toEqual({ appName: 'LongTail', themes: [] });
  });

  it('returns theme metadata without the css payload', () => {
    configureBranding({ themes: [MIDNIGHT] });
    expect(getBranding().themes).toEqual([
      { id: 'midnight', label: 'Midnight', swatch: '#0B1220', dark: true },
    ]);
    expect(JSON.stringify(getBranding())).not.toContain('--lt-surface');
  });

  it('keeps appName overrides alongside themes', () => {
    configureBranding({ appName: 'Acme Ops', themes: [MIDNIGHT] });
    expect(getBranding().appName).toBe('Acme Ops');
  });
});

describe('getCustomCss', () => {
  it('is empty when nothing is registered', () => {
    expect(getCustomCss()).toBe('');
  });

  it('serves raw customCss', () => {
    configureBranding({ customCss: ':root { --lt-accent: 1 2 3; }' });
    expect(getCustomCss()).toBe(':root { --lt-accent: 1 2 3; }');
  });

  it('concatenates customCss with every theme block', () => {
    configureBranding({ customCss: ':root { --lt-radius-field: 0; }', themes: [MIDNIGHT] });
    const css = getCustomCss();
    expect(css).toContain('--lt-radius-field: 0');
    expect(css).toContain("[data-theme='midnight']");
    expect(css.indexOf('--lt-radius-field')).toBeLessThan(css.indexOf('midnight'));
  });
});
