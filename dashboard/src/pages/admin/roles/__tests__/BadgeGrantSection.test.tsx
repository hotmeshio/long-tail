import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BadgeGrantSection, patchBadgeGrantDraft, readBadgeGrantDraft } from '../sections/BadgeGrantSection';
import type { Draft } from '../role-detail-shared';

describe('badge_grant draft helpers', () => {
  it('writes and clears fields without disturbing the rest of the bag', () => {
    const withGrant = patchBadgeGrantDraft('{"kiosk":true}', { ttl_seconds: 600 })!;
    expect(JSON.parse(withGrant)).toEqual({ kiosk: true, badge_grant: { ttl_seconds: 600 } });
    expect(readBadgeGrantDraft(withGrant)).toEqual({ ttl_seconds: 600 });
    const cleared = patchBadgeGrantDraft(withGrant, { ttl_seconds: undefined })!;
    expect(JSON.parse(cleared)).toEqual({ kiosk: true });
  });

  it('leaves an unparseable bag alone', () => {
    expect(patchBadgeGrantDraft('{oops', { max_uses: 0 })).toBeNull();
  });
});

describe('BadgeGrantSection', () => {
  it('ten minutes, unlimited: two fields into properties.badge_grant', () => {
    const update = vi.fn();
    render(<BadgeGrantSection draft={{ properties: '{}' } as Draft} update={update} />);
    fireEvent.change(screen.getByLabelText('Acts per badge scan'), { target: { value: '0' } });
    expect(JSON.parse(update.mock.calls[0][0].properties)).toEqual({ badge_grant: { max_uses: 0 } });
  });
});
