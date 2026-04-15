/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#FFFFFF',
          raised: '#FFFFFF',
          sunken: '#F5F5F7',
          hover: '#F7F4FF',
          border: '#E0DAF0',
        },
        text: {
          primary: '#1E1535',
          secondary: '#5B5173',
          tertiary: '#918AAB',
          inverse: '#FFFFFF',
        },
        accent: {
          DEFAULT: '#6C47FF',
          hover: '#5835DB',
          muted: '#C8BEF0',
          faint: '#E8E2F8',
        },
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
      maxWidth: {
        dashboard: '1440px',
      },
    },
  },
  plugins: [],
};
