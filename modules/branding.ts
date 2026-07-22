/**
 * Runtime branding config surfaced to the dashboard via /api/settings.
 *
 * The `appName` defaults to 'LongTail' and can be overridden via the
 * `branding` block of the `start()` config — no env-var required, since
 * this is a per-deployment product decision, not an ops toggle.
 *
 * `customCss` and `themes` carry the deployment's design-system overrides.
 * Theme metadata (id, label, swatch, dark) rides the /api/settings JSON so
 * the picker can render; the CSS itself is served separately at
 * GET /api/settings/custom.css so the browser caches it as a stylesheet.
 */

export interface LTBrandingTheme {
  id: string;
  label: string;
  swatch: string;
  css: string;
  dark?: boolean;
}

export interface LTBrandingConfig {
  appName?: string;
  customCss?: string;
  themes?: LTBrandingTheme[];
}

let _appName = 'LongTail';
let _customCss = '';
let _themes: LTBrandingTheme[] = [];

export function configureBranding(patch?: LTBrandingConfig): void {
  if (patch?.appName) _appName = patch.appName;
  if (typeof patch?.customCss === 'string') _customCss = patch.customCss;
  if (Array.isArray(patch?.themes)) _themes = patch.themes;
}

/** Metadata only — the CSS never rides the settings JSON. */
export function getBranding(): {
  appName: string;
  themes: Array<Omit<LTBrandingTheme, 'css'>>;
} {
  return {
    appName: _appName,
    themes: _themes.map(({ id, label, swatch, dark }) => ({ id, label, swatch, dark })),
  };
}

/** The full stylesheet served at /api/settings/custom.css. */
export function getCustomCss(): string {
  const parts = [_customCss, ..._themes.map((t) => t.css)].filter(Boolean);
  return parts.join('\n\n');
}
