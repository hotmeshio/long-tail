import { describe, it, expect } from 'vitest';
import { isChoiceEnabled, matchChoiceByCode } from '../choice-code';
import type { ScanPresentedChoice } from '../../../../api/scan-codes';

const choice = (patch: Partial<ScanPresentedChoice>): ScanPresentedChoice => ({
  index: 0,
  label: 'Collected',
  verb: 'resolve',
  withheld: false,
  ...patch,
});

describe('isChoiceEnabled', () => {
  it('an unwithheld choice is enabled with or without a badge', () => {
    expect(isChoiceEnabled(choice({}), false)).toBe(true);
    expect(isChoiceEnabled(choice({}), true)).toBe(true);
  });

  it('a withheld choice is disabled until a badge primes', () => {
    const withheld = choice({ withheld: true, requireActingIdentity: true });
    expect(isChoiceEnabled(withheld, false)).toBe(false);
    expect(isChoiceEnabled(withheld, true)).toBe(true);
  });
});

describe('matchChoiceByCode', () => {
  const choices: ScanPresentedChoice[] = [
    choice({ index: 0, label: 'Collected', code: 'COLLECT' }),
    choice({ index: 1, label: 'Ship it', code: 'SHIP', withheld: true, requireActingIdentity: true }),
    choice({ index: 2, label: 'Show it' }),
  ];

  it('selects the enabled choice whose code matches exactly', () => {
    expect(matchChoiceByCode(choices, false, 'COLLECT')?.index).toBe(0);
  });

  it('never partial-matches', () => {
    expect(matchChoiceByCode(choices, false, 'COLLECT-2')).toBeNull();
    expect(matchChoiceByCode(choices, false, 'COL')).toBeNull();
  });

  it('a withheld choice does not match without a badge', () => {
    expect(matchChoiceByCode(choices, false, 'SHIP')).toBeNull();
  });

  it('a withheld choice matches once a badge primes', () => {
    expect(matchChoiceByCode(choices, true, 'SHIP')?.index).toBe(1);
  });

  it('codeless choices never match, and unknown strings fall through', () => {
    expect(matchChoiceByCode(choices, true, 'Show it')).toBeNull();
    expect(matchChoiceByCode(choices, true, '10:4:SN-1234')).toBeNull();
  });
});
