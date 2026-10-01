import { describe, it, expect } from 'vitest';

import { itemLabel, type EscalationItem } from '../escalation-items';

const bag: EscalationItem = {
  itemKey: '6f1c2d3e-0000-4000-8000-000000000001',
  at: '2026-09-30T10:00:00Z',
  actor: 'user-1',
  payload: { stickerCode: 'VC531C38', weight: 2 },
};

describe('itemLabel', () => {
  it('interpolates item tokens from the template', () => {
    expect(itemLabel('{{item.payload.stickerCode}}', bag)).toBe('VC531C38');
  });

  it('mixes item tokens with the escalation domains and literal text', () => {
    expect(itemLabel('{{item.payload.stickerCode}} in {{metadata.binKey}}', bag, { metadata: { binKey: 'S-7' } }))
      .toBe('VC531C38 in S-7');
  });

  it('falls back when every token is missing, or there is no template', () => {
    expect(itemLabel('{{item.payload.sticker}}', bag)).toBeNull();
    expect(itemLabel(undefined, bag)).toBeNull();
    expect(itemLabel('  ', bag)).toBeNull();
    expect(itemLabel(42, bag)).toBeNull();
  });

  it('keeps a label when at least one token resolves', () => {
    expect(itemLabel('{{item.payload.stickerCode}} / {{item.payload.lane}}', bag)).toBe('VC531C38 / —');
  });

  it('reads the item key itself', () => {
    expect(itemLabel('Bag {{item.itemKey}}', { itemKey: 'B-1', at: '' })).toBe('Bag B-1');
  });
});
