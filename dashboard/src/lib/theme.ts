/**
 * Pluggable accent theme. One of four hues; the palette itself lives in
 * src/styles/globals.css as CSS variables keyed by data-theme on <html>.
 */
export const THEMES = ['violet', 'red', 'green', 'blue', 'rose'] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'blue';

/** Swatch hex per theme, used only to paint the picker itself. */
export const THEME_SWATCHES: Record<Theme, string> = {
  violet: '#7B3BE0',
  red: '#DC382D',
  green: '#059669',
  blue: '#1E3A8A',
  rose: '#D6246E',
};

export const THEME_LABELS: Record<Theme, string> = {
  violet: 'Violet',
  red: 'Brick',
  green: 'Emerald',
  blue: 'Navy',
  rose: 'Raspberry',
};

const STORAGE_KEY = 'lt.theme';

function isTheme(value: string | null): value is Theme {
  return THEMES.includes(value as Theme);
}

export function getTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
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
