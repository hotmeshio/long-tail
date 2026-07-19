import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../services/escalation', () => ({}));
vi.mock('../../../services/user', () => ({
  hasGlobalEscalationAccess: vi.fn(),
  getRoleScope: vi.fn(),
}));
vi.mock('../../../lib/events/publish', () => ({
  publishEscalationEvent: vi.fn(),
}));

import { assertLiveClaimant } from '../../../api/escalations/helpers';

const USER = 'user-1';
const OTHER = 'user-2';

function inFuture(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function inPast(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

describe('assertLiveClaimant', () => {
  it('passes an unclaimed row (system resolvers resolve unclaimed rows by design)', () => {
    expect(assertLiveClaimant(USER, { assigned_to: null, assigned_until: null })).toBeNull();
  });

  it('passes when the caller holds a live claim', () => {
    const result = assertLiveClaimant(USER, {
      assigned_to: USER,
      assigned_until: inFuture(30),
    });
    expect(result).toBeNull();
  });

  it('blocks with 409 when the caller\'s claim has expired', () => {
    const result = assertLiveClaimant(USER, {
      assigned_to: USER,
      assigned_until: inPast(1),
    });
    expect(result).toEqual({
      status: 409,
      error: expect.stringContaining('claim has expired'),
    });
  });

  it('passes a durable pre-assignment — assigned_to with no expiry window is routing, not a lock', () => {
    expect(assertLiveClaimant(USER, { assigned_to: USER, assigned_until: null })).toBeNull();
    expect(assertLiveClaimant(USER, { assigned_to: OTHER, assigned_until: null })).toBeNull();
  });

  it('blocks with 409 when another user holds a live claim', () => {
    const result = assertLiveClaimant(USER, {
      assigned_to: OTHER,
      assigned_until: inFuture(30),
    });
    expect(result).toEqual({
      status: 409,
      error: expect.stringContaining('claimed by another user'),
    });
  });

  it('passes when another user\'s claim window has lapsed — the lock is gone, the row is back in the pool', () => {
    expect(assertLiveClaimant(USER, { assigned_to: OTHER, assigned_until: inPast(5) })).toBeNull();
  });

  it('accepts Date instances for assigned_until', () => {
    expect(
      assertLiveClaimant(USER, {
        assigned_to: USER,
        assigned_until: new Date(Date.now() + 60_000),
      }),
    ).toBeNull();
    expect(
      assertLiveClaimant(USER, {
        assigned_to: USER,
        assigned_until: new Date(Date.now() - 60_000),
      })?.status,
    ).toBe(409);
  });
});
