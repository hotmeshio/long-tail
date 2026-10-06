import { describe, it, expect, vi } from 'vitest';

// The bag-and-bin demo seeds through the same validation as any rule.
const seeded: { schemes: any[]; rules: any[] } = { schemes: [], rules: [] };
vi.mock('../../services/scan-code', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    seedScanScheme: vi.fn(async (s: any) => { actual.assertValidScheme(s); seeded.schemes.push(s); return true; }),
    seedScanRule: vi.fn(async (r: any) => { actual.assertValidSteps(r.steps); seeded.rules.push(r); return true; }),
  };
});

import { seedBinScanCodes } from '../../examples/seed-scan-bins';

describe('seedBinScanCodes', () => {
  it('seeds the bag and bin labels with rules that pass validation', async () => {
    await seedBinScanCodes();
    expect(seeded.schemes.map((s) => s.version)).toEqual([12, 13]);
    expect(seeded.rules.map((r) => `${r.scheme_version}:${r.category} ${r.name}`)).toEqual(['12:0 Hold bag', '13:0 Bin it']);
    const binIt = seeded.rules[1].steps[0];
    expect(binIt).toMatchObject({ verb: 'accumulate', subject: { schemes: [12] }, params: { accumulate: { from: 'subject' } } });
  });
});
