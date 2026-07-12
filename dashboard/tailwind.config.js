/** @type {import('tailwindcss').Config} */

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
          DEFAULT: '#FFFFFF',
          raised: '#FFFFFF',
          sunken: '#F5F5F7',
          hover: themed('--lt-surface-hover'),
          border: themed('--lt-surface-border'),
        },
        text: {
          primary: themed('--lt-text-primary'),
          secondary: themed('--lt-text-secondary'),
          tertiary: themed('--lt-text-tertiary'),
          quaternary: themed('--lt-text-quaternary'),
          inverse: '#FFFFFF',
        },
        accent: {
          DEFAULT: themed('--lt-accent'),
          hover: themed('--lt-accent-hover'),
          muted: themed('--lt-accent-muted'),
          faint: themed('--lt-accent-faint'),
        },
        heading: themed('--lt-heading'),
        status: {
          active: '#2563EB',
          pending: '#F59E0B',
          draft: '#F97316',
          success: '#16A34A',
          warning: '#F59E0B',
          error: '#DC2626',
        },
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
  plugins: [],
};
