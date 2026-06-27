import { describe, it, expect } from 'vitest';

import {
  composePriorityOrder,
  DEFAULT_PRIORITY_RULES,
  PRIORITY_RULES,
  isKeyAccount,
} from '../../examples/workflows/print-routing/policy/priority';

// The pluggable priority layer: routing's fourth stage made a business decision.
// The broker composes an ordered list of named rules into a FacetOrder[]; the
// sequence is policy, swappable without touching the broker.

describe('composePriorityOrder', () => {
  it('flattens an ordered rule list into FacetOrder[] in sequence', () => {
    expect(composePriorityOrder(['keyAccount', 'fifo'])).toEqual([
      { field: 'metadata.keyAccount', direction: 'desc' },
      { field: 'created_at', direction: 'asc' },
    ]);
  });

  it('applies the standing default policy when none is given', () => {
    expect(DEFAULT_PRIORITY_RULES).toEqual(['pastDue', 'keyAccount', 'reprint', 'fifo']);
    expect(composePriorityOrder()).toEqual([
      ...PRIORITY_RULES.pastDue,
      ...PRIORITY_RULES.keyAccount,
      ...PRIORITY_RULES.reprint,
      ...PRIORITY_RULES.fifo,
    ]);
  });

  it('ignores unknown rule names (no fragment contributed)', () => {
    expect(composePriorityOrder(['nope', 'fifo'])).toEqual([{ field: 'created_at', direction: 'asc' }]);
  });

  it('reordering the policy reorders the sequence — the sequence is the policy', () => {
    const reprintFirst = composePriorityOrder(['reprint', 'pastDue']);
    const dueFirst = composePriorityOrder(['pastDue', 'reprint']);
    expect(reprintFirst).not.toEqual(dueFirst);
    expect(reprintFirst[0]).toEqual(PRIORITY_RULES.reprint[0]);
    expect(dueFirst[0]).toEqual(PRIORITY_RULES.pastDue[0]);
  });
});

describe('isKeyAccount', () => {
  it('recognizes configured key accounts and nothing else', () => {
    expect(isKeyAccount('kacct-1')).toBe(true);
    expect(isKeyAccount('walk-in-customer')).toBe(false);
  });
});
