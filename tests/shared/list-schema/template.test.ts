import { describe, it, expect } from 'vitest';

import { resolveRelatedFacets, resolveTemplateValue, rowTemplateContext } from '../../../shared/list-schema';

const row = {
  id: 'r1',
  role: 'bin',
  metadata: { destination: 7, site: 'north', empty: '' },
  envelope: JSON.stringify({ data: { lane: 'A' } }),
  escalation_payload: null,
  resolver_payload: '{"ok":true}',
};
const ctx = rowTemplateContext(row);

describe('row template values', () => {
  it('parses JSON-string columns into domains', () => {
    expect(ctx.envelope).toEqual({ data: { lane: 'A' } });
    expect(ctx.resolver).toEqual({ ok: true });
    expect(ctx.payload).toEqual({});
  });

  it('keeps a lone token at its own JSON type', () => {
    expect(resolveTemplateValue('{{metadata.destination}}', ctx)).toBe(7);
    expect(resolveTemplateValue('{{ envelope.data.lane }}', ctx)).toBe('A');
  });

  it('interpolates mixed templates and passes literals through', () => {
    expect(resolveTemplateValue('{{metadata.site}}-{{envelope.data.lane}}', ctx)).toBe('north-A');
    expect(resolveTemplateValue('fixed', ctx)).toBe('fixed');
    expect(resolveTemplateValue(3, ctx)).toBe(3);
  });

  it('treats a missing or empty token as unresolved', () => {
    expect(resolveTemplateValue('{{metadata.absent}}', ctx)).toBeUndefined();
    expect(resolveTemplateValue('{{metadata.empty}}', ctx)).toBeUndefined();
    expect(resolveTemplateValue('x-{{metadata.absent}}', ctx)).toBeUndefined();
    expect(resolveTemplateValue('{{nowhere.x}}', ctx)).toBeUndefined();
  });

  it('resolves a facet map, or null when any value is missing', () => {
    expect(resolveRelatedFacets({ destination: '{{metadata.destination}}', kind: 'order' }, ctx))
      .toEqual({ destination: 7, kind: 'order' });
    expect(resolveRelatedFacets({ destination: '{{metadata.absent}}' }, ctx)).toBeNull();
  });

  it('adds each narrow facet the row resolves and drops the rest', () => {
    expect(resolveRelatedFacets({ site: '{{metadata.site}}' }, ctx, { destination: '{{metadata.destination}}', lane: '{{metadata.lane}}' }))
      .toEqual({ site: 'north', destination: 7 });
    expect(resolveRelatedFacets({ site: '{{metadata.absent}}' }, ctx, { destination: '{{metadata.destination}}' })).toBeNull();
  });
});
