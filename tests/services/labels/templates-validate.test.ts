import { describe, it, expect } from 'vitest';

import { assertValidTemplate, LabelTemplateValidationError, type TemplateContext } from '../../../services/labels/templates/validate';
import type { LabelTemplateInput } from '../../../types/labels';

const scheme = (over: Record<string, unknown> = {}) => ({
  version: 14, name: 'Items', target_facet: 'itemKey', encoding: 'delimited', delimiter: ':', target_length: null,
  kind: 'action', enabled: true, ...over,
}) as any;

const rules = [
  { scheme_version: 14, category: '0', name: 'Check in', enabled: true },
  { scheme_version: 14, category: '1', name: 'Check out', enabled: true },
] as any[];

const ctx = (over: Partial<TemplateContext> = {}): TemplateContext => ({
  scheme: scheme(), rules, identityKeys: ['badge_id'], mediaIds: ['a4-l7160'], ...over,
});

const input = (over: Partial<LabelTemplateInput> = {}): LabelTemplateInput => ({
  name: 'two-code-label', scheme_version: 14, title: 'Two-code label',
  codes: [{ category: '0', tone: 'solid' }, { category: '1', tone: 'outline' }],
  text: { title: '{target}', lines: ['{item.subtitle}'] },
  ...over,
});

const refuses = (i: LabelTemplateInput, c: TemplateContext, message: RegExp) =>
  expect(() => assertValidTemplate(i, c)).toThrow(message);

describe('assertValidTemplate', () => {
  it('accepts a two-code intent label', () => {
    expect(() => assertValidTemplate(input(), ctx())).not.toThrow();
  });

  it('refuses a bad name, a missing scheme, and a read-only scheme', () => {
    refuses(input({ name: 'Two Code' }), ctx(), /lowercase/);
    refuses(input(), ctx({ scheme: null }), /does not exist/);
    refuses(input(), ctx({ scheme: scheme({ encoding: 'gtin' }) }), /fixed and delimited codes only/);
  });

  it('needs 1 to 4 codes, each a rule of the scheme, printed once', () => {
    refuses(input({ codes: [] }), ctx(), /1 to 4/);
    refuses(input({ codes: [{ category: '7', tone: 'solid' }] }), ctx(), /no rule for category "7"/);
    refuses(input({ codes: [{ category: '0', tone: 'solid' }, { category: '0', tone: 'plain' }] }), ctx(), /printed twice/);
    refuses(input({ codes: [{ category: '0', tone: 'loud' as any }] }), ctx(), /tone/);
  });

  it('allows up to two lines', () => {
    refuses(input({ text: { lines: ['a', 'b', 'c'] } }), ctx(), /up to 2 lines/);
  });

  it('names unknown tokens', () => {
    refuses(input({ text: { title: '{bogus}' } }), ctx(), /unknown token \{bogus\}/);
  });

  it('keeps user tokens on identity templates and item tokens on action templates', () => {
    refuses(input({ text: { title: '{user.display_name}' } }), ctx(), /identity templates only/);
    const badge = ctx({ scheme: scheme({ kind: 'identity', target_facet: 'badge_id' }) });
    refuses(input({ text: { title: '{item.x}' } }), badge, /not \{item/);
  });

  it('never prints a credential as text', () => {
    const badge = ctx({ scheme: scheme({ kind: 'identity', target_facet: 'badge_id' }) });
    refuses(input({ text: { title: '{user.badge_id}' } }), badge, /never prints as text/);
    refuses(input({ text: { title: 'ID {target}' } }), badge, /credential/);
  });

  it('refuses an identity template marked not sensitive', () => {
    const badge = ctx({ scheme: scheme({ kind: 'identity', target_facet: 'badge_id' }) });
    refuses(input({ text: { title: '{user.display_name}' }, sensitive: false }), badge, /always sensitive/);
  });

  it('refuses unknown media and symbology', () => {
    refuses(input({ media: 'letter-9999' }), ctx(), /unknown media/);
    refuses(input({ symbology: 'pdf417' as any }), ctx(), /symbology/);
  });

  it('throws a 400 validation error', () => {
    try {
      assertValidTemplate(input({ codes: [] }), ctx());
    } catch (err) {
      expect(err).toBeInstanceOf(LabelTemplateValidationError);
      expect((err as LabelTemplateValidationError).status).toBe(400);
    }
  });
});
