import { describe, it, expect } from 'vitest';
import { ESCALATION_FILE_REFS_MAX, assertFileRefs, normalizeFileRefPath } from '../../types/escalation';

describe('assertFileRefs (creation-path contract)', () => {
  it('accepts well-formed refs', () => {
    expect(() => assertFileRefs([
      { path: 'referrals/r-1.pdf', as: 'referral' },
      { path: '/cards/c-1', as: 'insurance_card', name: 'Card', contentType: 'image/jpeg', expiresIn: 1800 },
    ])).not.toThrow();
  });

  it('rejects paths that leave the store or are not keys', () => {
    for (const path of ['../x.pdf', 'a/../../x.pdf', 'a/./x.pdf', '', '/', 'a\\b.pdf', 'a\0b', 42]) {
      expect(() => assertFileRefs([{ path, as: 'doc' }]), String(path)).toThrow(/storage key/);
    }
  });

  it('rejects an alias the form cannot address', () => {
    for (const as of ['', '1doc', 'my doc', 'a.b', undefined]) {
      expect(() => assertFileRefs([{ path: 'a.pdf', as }]), String(as)).toThrow(/"as"/);
    }
  });

  it('rejects malformed name, contentType and expiresIn', () => {
    expect(() => assertFileRefs([{ path: 'a.pdf', as: 'a', name: '' }])).toThrow(/name/);
    expect(() => assertFileRefs([{ path: 'a.pdf', as: 'a', contentType: 'pdf' }])).toThrow(/contentType/);
    expect(() => assertFileRefs([{ path: 'a.pdf', as: 'a', expiresIn: 0 }])).toThrow(/expiresIn/);
    expect(() => assertFileRefs([{ path: 'a.pdf', as: 'a', expiresIn: 1.5 }])).toThrow(/expiresIn/);
  });

  it('rejects duplicates, non-arrays and oversized lists', () => {
    expect(() => assertFileRefs([{ path: 'a.pdf', as: 'd' }, { path: 'b.pdf', as: 'd' }])).toThrow(/more than one file/);
    expect(() => assertFileRefs({ path: 'a.pdf', as: 'd' })).toThrow(/array/);
    const many = Array.from({ length: ESCALATION_FILE_REFS_MAX + 1 }, (_, i) => ({ path: `f${i}.pdf`, as: `f${i}` }));
    expect(() => assertFileRefs(many)).toThrow(/at most/);
  });
});

describe('normalizeFileRefPath', () => {
  it('strips leading slashes and keeps the key', () => {
    expect(normalizeFileRefPath('//a/b.pdf')).toBe('a/b.pdf');
    expect(normalizeFileRefPath('a/..b.pdf')).toBe('a/..b.pdf');
  });
});
