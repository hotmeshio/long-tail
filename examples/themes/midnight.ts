/**
 * Midnight — the bundled dark theme, registered through branding.themes to
 * demonstrate full external control of the design system: every color the
 * dashboard paints flows through a --lt-* variable, so one CSS block restyles
 * the built-in pages and the generated x-lt-* forms alike. Deployments author
 * their own themes the same way; nothing here is special-cased.
 */

export const midnightTheme = {
  id: 'midnight',
  label: 'Midnight',
  swatch: '#0B1220',
  dark: true,
  css: `
[data-theme='midnight'] {
  color-scheme: dark;
  --lt-color-scheme: dark;

  /* Surfaces */
  --lt-surface: 11 18 32;            /* #0B1220 page */
  --lt-surface-raised: 17 26 44;     /* #111A2C header, sidebar, sheets */
  --lt-surface-sunken: 8 13 24;      /* #080D18 section bands */
  --lt-surface-hover: 22 33 58;      /* #16213A row/button hover */
  --lt-surface-border: 38 53 83;     /* #263553 rules and dividers */

  /* Fields — lighter than the page so inputs pop forward */
  --lt-field-bg: 20 30 51;           /* #141E33 */
  --lt-field-border: 51 69 107;      /* #33456B */
  --lt-field-focus: 26 39 69;        /* #1A2745 */

  /* Accent family */
  --lt-accent: 77 141 255;           /* #4D8DFF */
  --lt-accent-hover: 110 161 255;    /* #6EA1FF — hover lightens on dark */
  --lt-accent-muted: 53 82 154;      /* #35529A */
  --lt-accent-faint: 20 38 74;       /* #14264A — tint backgrounds stay dark */
  --lt-heading: 127 168 255;         /* #7FA8FF */
  --lt-logo: 77 141 255;

  /* Text ramp */
  --lt-text-primary: 232 237 248;    /* #E8EDF8 */
  --lt-text-secondary: 174 192 228;  /* #AEC0E4 */
  --lt-text-tertiary: 126 150 198;   /* #7E96C6 */
  --lt-text-quaternary: 90 111 158;  /* #5A6F9E — large/meta only */
  --lt-text-inverse: 255 255 255;

  /* Status — lightened for AA against the dark surface */
  --lt-status-active: 92 155 255;    /* #5C9BFF */
  --lt-status-pending: 255 180 84;   /* #FFB454 */
  --lt-status-draft: 255 157 102;    /* #FF9D66 */
  --lt-status-success: 74 222 128;   /* #4ADE80 */
  --lt-status-warning: 255 180 84;
  --lt-status-error: 255 107 107;    /* #FF6B6B */
  --lt-status-pending-graphic: 251 191 36;   /* #FBBF24 */
  --lt-status-draft-graphic: 251 146 60;     /* #FB923C */
  --lt-status-success-graphic: 52 211 153;   /* #34D399 */
  --lt-status-queued: 56 189 248;    /* #38BDF8 */
  --lt-status-claimed: 251 146 60;   /* #FB923C */
  --lt-status-queued-graphic: 56 189 248;
  --lt-status-claimed-graphic: 251 146 60;

  /* Light chevron stroke for selects */
  --lt-select-chevron: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23AEC0E4' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
}
`,
};
