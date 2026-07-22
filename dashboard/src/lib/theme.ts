/**
 * Pluggable accent theme. The palette lives in src/styles/globals.css as CSS
 * variables keyed by data-theme on <html>. Deployments register additional
 * themes at startup (branding.themes in start()); their CSS arrives via
 * /api/settings/custom.css and their metadata joins the picker through
 * registerThemes().
 *
 * The stored theme id is applied as-is: an unknown data-theme value (e.g. a
 * registered theme that was since removed) harmlessly resolves to the :root
 * default palette.
 */

export interface ThemeDefinition {
  id: string;
  label: string;
  swatch: string;
  dark?: boolean;
}

export type Theme = string;

export const BUILT_IN_THEMES: ThemeDefinition[] = [
  { id: 'violet', label: 'Violet', swatch: '#7B3BE0' },
  { id: 'red', label: 'Brick', swatch: '#DC382D' },
  { id: 'green', label: 'Emerald', swatch: '#059669' },
  { id: 'blue', label: 'Electric', swatch: '#2563EB' },
  { id: 'rose', label: 'Raspberry', swatch: '#D6246E' },
  { id: 'orange', label: 'Harvest', swatch: '#E85D04' },
];

export const DEFAULT_THEME: Theme = 'blue';

const STORAGE_KEY = 'lt.theme';

let registeredThemes: ThemeDefinition[] = [];

/** Merge deployment-registered themes into the picker (built-in ids win). */
export function registerThemes(themes: ThemeDefinition[]): void {
  const builtInIds = new Set(BUILT_IN_THEMES.map((t) => t.id));
  const seen = new Set<string>();
  registeredThemes = themes.filter((t) => {
    if (!t?.id || builtInIds.has(t.id) || seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

export function getAllThemes(): ThemeDefinition[] {
  return [...BUILT_IN_THEMES, ...registeredThemes];
}

export function getTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage unavailable (private mode) — theme still applies for the session.
  }
  applyTheme(theme);
}
