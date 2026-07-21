import { describe, it, expect, beforeEach } from 'vitest';
import {
  BUILT_IN_THEMES,
  DEFAULT_THEME,
  registerThemes,
  getAllThemes,
  getTheme,
  setTheme,
} from '../theme';

beforeEach(() => {
  registerThemes([]);
  localStorage.clear();
});

describe('registerThemes / getAllThemes', () => {
  it('returns the six built-ins by default', () => {
    expect(getAllThemes()).toEqual(BUILT_IN_THEMES);
    expect(BUILT_IN_THEMES.map((t) => t.id)).toContain(DEFAULT_THEME);
  });

  it('appends registered themes after the built-ins', () => {
    registerThemes([{ id: 'midnight', label: 'Midnight', swatch: '#0B1220', dark: true }]);
    const all = getAllThemes();
    expect(all).toHaveLength(BUILT_IN_THEMES.length + 1);
    expect(all[all.length - 1].id).toBe('midnight');
  });

  it('ignores registrations that collide with built-in ids or repeat', () => {
    registerThemes([
      { id: 'blue', label: 'Not Blue', swatch: '#000000' },
      { id: 'midnight', label: 'Midnight', swatch: '#0B1220' },
      { id: 'midnight', label: 'Midnight Again', swatch: '#000000' },
    ]);
    const all = getAllThemes();
    expect(all.filter((t) => t.id === 'midnight')).toHaveLength(1);
    expect(all.find((t) => t.id === 'blue')!.label).toBe('Electric');
  });

  it('re-registration replaces the registered set', () => {
    registerThemes([{ id: 'midnight', label: 'Midnight', swatch: '#0B1220' }]);
    registerThemes([]);
    expect(getAllThemes()).toEqual(BUILT_IN_THEMES);
  });
});

describe('getTheme / setTheme', () => {
  it('defaults to the default theme', () => {
    expect(getTheme()).toBe(DEFAULT_THEME);
  });

  it('persists any theme id, including registered ones', () => {
    setTheme('midnight');
    expect(getTheme()).toBe('midnight');
    expect(document.documentElement.dataset.theme).toBe('midnight');
  });
});
