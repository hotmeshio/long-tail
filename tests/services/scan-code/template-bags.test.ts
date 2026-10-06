import { describe, it, expect } from 'vitest';

import { interpolateScanTemplate, renderScanCopy, ScanTemplateError } from '../../../services/scan-code';

const base = { target: 'SF-B-9', category: '0', scannedAt: '2026-10-05T00:00:00Z' };

describe('scan template bags', () => {
  it('reads the subject, container, and fill bags', () => {
    const ctx = {
      ...base,
      subject: { binCode: 'SF-A-2', id: 'bag-row' },
      container: { facilityName: 'Acme East' },
      fill: { pending: ['A', 'B'] },
    };
    expect(interpolateScanTemplate("{container.facilityName}'s tub; this goes in {subject.binCode} ({subject.id})", ctx))
      .toBe("Acme East's tub; this goes in SF-A-2 (bag-row)");
    expect(interpolateScanTemplate('Expecting {fill.pending}', ctx)).toBe('Expecting A, B');
  });

  it('{scan.code} is the raw code, falling back to the target', () => {
    expect(interpolateScanTemplate('{scan.code}', { ...base, target: '00012345678905', code: '012345678905' })).toBe('012345678905');
    expect(interpolateScanTemplate('{scan.code}', base)).toBe('SF-B-9');
  });

  it('a subject token with no subject held throws rather than writing the literal', () => {
    expect(() => interpolateScanTemplate('{subject.binCode}', base)).toThrow(ScanTemplateError);
  });

  it('refusal copy degrades: an unreadable token becomes empty, the rest renders', () => {
    expect(renderScanCopy("That's {container.facilityName}'s tub. Use {subject.binCode}.", { ...base, subject: { binCode: 'SF-A-2' } }))
      .toBe("That's 's tub. Use SF-A-2.");
  });
});
