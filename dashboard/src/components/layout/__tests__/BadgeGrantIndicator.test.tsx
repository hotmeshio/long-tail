import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect } from 'react';

vi.mock('../../../api/client', () => ({
  setActingTokenProvider: vi.fn(),
  setActingIdentityClear: vi.fn(),
  setActingIdentitySpent: vi.fn(),
}));

import { ActingIdentityProvider, useActingIdentity } from '../../../hooks/useActingIdentity';
import { BadgeGrantIndicator, formatGrantRemaining } from '../BadgeGrantIndicator';
import type { ScanExecuteResponse } from '../../../api/scan-codes';

let actions: ReturnType<typeof useActingIdentity> | null = null;

function Capture() {
  const value = useActingIdentity();
  useEffect(() => { actions = value; });
  return null;
}

function primed(displayName: string, ttlMs: number | null): ScanExecuteResponse {
  return {
    outcome: 'identity_primed',
    actor: { id: `id-${displayName}`, displayName },
    actingToken: `eph:v1:acting_identity:${displayName}`,
    expiresAt: ttlMs === null ? undefined : new Date(Date.now() + ttlMs).toISOString(),
  } as ScanExecuteResponse;
}

function renderIndicator() {
  return render(
    <ActingIdentityProvider>
      <Capture />
      <BadgeGrantIndicator />
    </ActingIdentityProvider>,
  );
}

describe('BadgeGrantIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    actions = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing with no grant', () => {
    renderIndicator();
    expect(screen.queryByTestId('badge-grant-indicator')).toBeNull();
  });

  it('shows the badged person and the minutes left while a grant is live', () => {
    renderIndicator();
    act(() => { actions!.prime(primed('Dana', 7 * 60_000 + 30_000)); });
    expect(screen.getByTestId('badge-grant-indicator').textContent).toContain('Dana');
    expect(screen.getByTestId('badge-grant-remaining').textContent).toBe('· 7 min');
  });

  it('counts down, switching to seconds under a minute', () => {
    renderIndicator();
    act(() => { actions!.prime(primed('Dana', 2 * 60_000)); });
    expect(screen.getByTestId('badge-grant-remaining').textContent).toBe('· 2 min');
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(screen.getByTestId('badge-grant-remaining').textContent).toBe('· 59 s');
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByTestId('badge-grant-remaining').textContent).toBe('· 29 s');
  });

  it('clears when the grant lapses', () => {
    renderIndicator();
    act(() => { actions!.prime(primed('Dana', 5_000)); });
    expect(screen.getByTestId('badge-grant-indicator')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(screen.queryByTestId('badge-grant-indicator')).toBeNull();
  });

  it('clears when the grant is retired', () => {
    renderIndicator();
    act(() => { actions!.prime(primed('Dana', 60_000)); });
    act(() => { actions!.clear(); });
    expect(screen.queryByTestId('badge-grant-indicator')).toBeNull();
  });

  it('shows the name alone for a grant with no expiry', () => {
    renderIndicator();
    act(() => { actions!.prime(primed('Dana', null)); });
    expect(screen.getByTestId('badge-grant-indicator').textContent).toContain('Dana');
    expect(screen.queryByTestId('badge-grant-remaining')).toBeNull();
  });
});

describe('formatGrantRemaining', () => {
  it('reads whole minutes at a minute or more, seconds below', () => {
    expect(formatGrantRemaining(600)).toBe('10 min');
    expect(formatGrantRemaining(119)).toBe('1 min');
    expect(formatGrantRemaining(60)).toBe('1 min');
    expect(formatGrantRemaining(59)).toBe('59 s');
    expect(formatGrantRemaining(0)).toBe('0 s');
  });
});
