/** @type {import('tailwindcss').Config} */

import containerQueries from '@tailwindcss/container-queries';

/*
 * Themed tokens resolve through CSS variables declared in src/styles/globals.css.
 * The active theme is selected by `data-theme` on <html> (violet | red | orange | blue).
 * Variables hold space-separated RGB channels so Tailwind opacity modifiers keep working.
 */
const themed = (channels) => `rgb(var(${channels}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: themed('--lt-surface'),
          raised: themed('--lt-surface-raised'),
          sunken: themed('--lt-surface-sunken'),
          hover: themed('--lt-surface-hover'),
          border: themed('--lt-surface-border'),
          field: themed('--lt-field-bg'),
          'field-border': themed('--lt-field-border'),
          'field-focus': themed('--lt-field-focus'),
        },
        text: {
          primary: themed('--lt-text-primary'),
          secondary: themed('--lt-text-secondary'),
          tertiary: themed('--lt-text-tertiary'),
          quaternary: themed('--lt-text-quaternary'),
          inverse: themed('--lt-text-inverse'),
        },
        accent: {
          DEFAULT: themed('--lt-accent'),
          hover: themed('--lt-accent-hover'),
          muted: themed('--lt-accent-muted'),
          faint: themed('--lt-accent-faint'),
        },
        heading: themed('--lt-heading'),
        /* Text-safe status values; the -graphic variants keep the brighter
         * hues for dots, bars, and charts (3:1 graphic contrast). */
        status: {
          active: themed('--lt-status-active'),
          pending: themed('--lt-status-pending'),
          draft: themed('--lt-status-draft'),
          success: themed('--lt-status-success'),
          warning: themed('--lt-status-warning'),
          error: themed('--lt-status-error'),
          'pending-graphic': themed('--lt-status-pending-graphic'),
          'draft-graphic': themed('--lt-status-draft-graphic'),
          'success-graphic': themed('--lt-status-success-graphic'),
          queued: themed('--lt-status-queued'),
          claimed: themed('--lt-status-claimed'),
          'queued-graphic': themed('--lt-status-queued-graphic'),
          'claimed-graphic': themed('--lt-status-claimed-graphic'),
        },
      },
      fontSize: {
        /* 11px floor for informative text — replaces ad-hoc text-[9px]/[10px]. */
        '2xs': 'var(--lt-type-2xs)',
      },
      spacing: {
        'page-x': 'var(--lt-space-page-x)',
        'page-y': 'var(--lt-space-page-y)',
        'field-y': 'var(--lt-space-field-y)',
        'col-gap': 'var(--lt-space-col-gap)',
      },
      maxWidth: {
        /* The readable measure for generated forms. */
        form: 'var(--lt-measure-form)',
      },
      /* Named container thresholds — the responsive doctrine's tokens.
       * Geometry follows the CONTAINER, not the viewport: components use
       * these variants (@dict-pairs:, @table:, …) and never hardcode rem. */
      containers: {
        'dict-inline': '22rem', /* label sits beside value (one pair per row) */
        'grp-cols': '26rem',    /* x-lt-column-group renders 2-up */
        'form-cols': '34rem',   /* section two-column grid splits */
        filters: '36rem',       /* filter bar shows inline selects */
        'dict-pairs': '38rem',  /* dictionary renders two pairs per row */
        table: '48rem',         /* tables render as tables; below, console cards */
        split: '54rem',         /* two-pane page grids split */
        wall: '64rem',          /* 3–4-up card walls spread */
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'border-breathe': {
          '0%, 100%': { borderColor: 'rgb(var(--lt-accent))' },
          '50%': { borderColor: 'transparent' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 200ms ease-out',
      },
    },
  },
  plugins: [containerQueries],
};
