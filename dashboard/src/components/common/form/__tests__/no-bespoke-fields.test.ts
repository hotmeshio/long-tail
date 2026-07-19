import { describe, it, expect } from 'vitest';

/**
 * Guardrail: text form controls must come from the core library — the .input /
 * .select / .textarea / .field / .input-json classes (or the shared Field
 * components built on them), never a hand-rolled full-border box. This keeps
 * the whole product on one field treatment so a single token/class override
 * restyles every field — the north star. If this fails, route the offending
 * control through the shared classes instead of inlining its own border+fill.
 *
 * Sources are read via Vite's import.meta.glob (?raw) so the scan runs with no
 * Node-fs dependency and stays in the browser tsconfig.
 */

const sources = import.meta.glob('/src/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// A standalone `border` width class (not border-b/-l/-surface-border/etc.) plus
// a surface/white fill — the old-school box we retired. Scoped to the control's
// own opening tag, so container <div>/<tr> borders are never implicated.
const FULL_BORDER = /\bborder\b(?![-\w])/;
const FILL = /\bbg-(surface|white)\b/;
const CORE_FIELD = /\b(input|select|textarea|field|input-json)\b/;
// Non-text controls draw their own affordance (custom checkbox, file button).
const SKIP_TYPE = /type=(["'`])(checkbox|radio|file|hidden|range|color)\1/;

describe('form field styling is centralized', () => {
  it('no text input/select/textarea hand-rolls a full-border + fill outside the core classes', () => {
    const offenders: string[] = [];
    const tagRe = /<(input|select|textarea)\b[^>]*?>/gs;
    for (const [path, src] of Object.entries(sources)) {
      if (path.includes('/__tests__/')) continue;
      for (const m of src.matchAll(tagRe)) {
        const tag = m[0];
        if (SKIP_TYPE.test(tag)) continue;
        if (FULL_BORDER.test(tag) && FILL.test(tag) && !CORE_FIELD.test(tag)) {
          offenders.push(`${path}: ${tag.replace(/\s+/g, ' ').slice(0, 110)}`);
        }
      }
    }
    expect(offenders, `Hand-rolled field styling — use .input/.select/.textarea:\n${offenders.join('\n')}`).toEqual([]);
  });
});
