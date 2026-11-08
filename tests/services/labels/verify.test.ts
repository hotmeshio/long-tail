import { describe, it, expect } from 'vitest';

import { verifyLabels } from '../../../services/labels/verify';

const scheme = { version: 14, name: 'Items', encoding: 'delimited', delimiter: ':', target_length: null, kind: 'action', enabled: true } as any;
const rules = [{ category: '0', name: 'Check in', enabled: true }, { category: '1', name: 'Check out', enabled: false }] as any[];
const template = { codes: [{ category: '0', tone: 'solid' }, { category: '1', tone: 'outline' }] } as any;
const content = (target: string) => ({ lines: [], codes: [{ code: `14:0:${target}`, caption: '', tone: 'solid' as const }, { code: `14:1:${target}`, caption: '', tone: 'outline' as const }] });

describe('verifyLabels', () => {
  it('flags a disabled rule on every label', () => {
    const w = verifyLabels(template, scheme, [scheme], rules, [{ target: 'A', resolved: true }], [content('A')]);
    expect(w).toEqual([expect.objectContaining({ index: 0, kind: 'rule_disabled' })]);
  });

  it('flags a code that does not read back as the scheme', () => {
    const other = { ...scheme, version: 15 };
    const w = verifyLabels(template, scheme, [other], [{ ...rules[0] }, { ...rules[1], enabled: true }], [{ target: 'A', resolved: true }], [content('A')]);
    expect(w.filter((x) => x.kind === 'unparseable')).toHaveLength(2);
  });

  it('flags an unresolved target', () => {
    const w = verifyLabels(template, scheme, [scheme], [rules[0], { ...rules[1], enabled: true }], [{ target: 'A', resolved: false }], [content('A')]);
    expect(w).toEqual([expect.objectContaining({ kind: 'unresolved', detail: 'A names no row today' })]);
  });

  it('flags every label of a disabled scheme', () => {
    const w = verifyLabels(template, { ...scheme, enabled: false }, [], rules, [{ target: 'A' }, { target: 'B' }], [content('A'), content('B')]);
    expect(w.map((x) => x.index)).toEqual([0, 1]);
  });

  it('identity warnings never name the credential', () => {
    const badge = { ...scheme, kind: 'identity' };
    const w = verifyLabels(template, badge, [], [rules[0], { ...rules[1], enabled: true }], [{ target: 'SECRET', resolved: false }], [content('SECRET')]);
    expect(JSON.stringify(w)).not.toContain('SECRET');
  });
});
