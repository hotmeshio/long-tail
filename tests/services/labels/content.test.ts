import { describe, it, expect } from 'vitest';

import { buildLabelContents } from '../../../services/labels/content';

const scheme = { version: 13, name: 'Items', encoding: 'delimited', delimiter: ':', target_length: null, kind: 'action', enabled: true } as any;
const rules = [{ category: '0', name: 'Check {target}', enabled: true }] as any[];
const template = (over: Record<string, unknown> = {}) => ({
  name: 't', scheme_version: 13, title: 'T', description: null, codes: [{ category: '0', caption: null, tone: 'solid' }],
  text: { title: '{target}', lines: ['{item.subtitle}'] }, symbology: 'code128', human_readable: true, media: null,
  sensitive: false, enabled: true, revision: 1, source: 'api', ...over,
}) as any;

describe('buildLabelContents', () => {
  it('fills text from each target\'s facts', () => {
    const { contents, warnings } = buildLabelContents(template(), scheme, rules, [{ target: 'A-1', item: { subtitle: 'Acme North' } }], false);
    expect(contents[0]).toMatchObject({ title: 'A-1', lines: ['Acme North'], codes: [{ code: '13:0:A-1' }] });
    expect(warnings).toEqual([]);
  });

  it('warns when a line reads a fact the label lacks, naming the facts it has', () => {
    const { warnings } = buildLabelContents(
      template({ text: { title: '{target}', lines: ['{item.region}'] } }), scheme, rules,
      [{ target: 'A-1', item: { subtitle: 'Acme North' } }], false,
    );
    expect(warnings).toEqual([{
      index: 0, kind: 'missing_token', detail: "line 1 reads {item.region}, which this label's data doesn't have (it has: subtitle)",
    }]);
  });

  it('warns once per token per label, and treats an empty value as missing', () => {
    const { warnings } = buildLabelContents(
      template({ text: { title: '{item.subtitle}', lines: ['{item.subtitle}'] } }), scheme, rules,
      [{ target: 'A-1', item: { subtitle: '' } }, { target: 'A-2', item: { subtitle: 'ok' } }], false,
    );
    expect(warnings.map((w) => [w.index, w.kind])).toEqual([[0, 'missing_token']]);
  });

  it('renders tokens in a template caption, never in a rule name', () => {
    const own = buildLabelContents(template({ codes: [{ category: '0', caption: 'Check {target}', tone: 'solid' }] }), scheme, rules, [{ target: 'A-1', item: { subtitle: 's' } }], false);
    expect(own.contents[0].codes[0].caption).toBe('Check A-1');
    const fromRule = buildLabelContents(template(), scheme, rules, [{ target: 'A-1', item: { subtitle: 's' } }], false);
    expect(fromRule.contents[0].codes[0].caption).toBe('Check {target}');
  });
});
