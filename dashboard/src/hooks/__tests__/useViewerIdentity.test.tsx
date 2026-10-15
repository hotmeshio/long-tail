import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const state: { user: { userId: string } | null; acting: { actorId: string } | null } = { user: null, acting: null };
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('../useActingIdentity', () => ({ useActingIdentity: () => ({ identity: state.acting }) }));

import { useViewerIdentity } from '../useViewerIdentity';

beforeEach(() => {
  state.user = { userId: 'station' };
  state.acting = null;
});

describe('useViewerIdentity', () => {
  it('is the signed-in account without a badge', () => {
    const { result } = renderHook(() => useViewerIdentity());
    expect(result.current.viewerId).toBe('station');
    expect(result.current.isViewer('station')).toBe(true);
    expect(result.current.isViewer('other')).toBe(false);
  });

  it('acts as the badged person and still recognizes the account', () => {
    state.acting = { actorId: 'packer' };
    const { result } = renderHook(() => useViewerIdentity());
    expect(result.current.viewerId).toBe('packer');
    expect(result.current.isViewer('packer')).toBe(true);
    expect(result.current.isViewer('station')).toBe(true);
  });

  it('never matches an empty assignee', () => {
    state.user = null;
    const { result } = renderHook(() => useViewerIdentity());
    expect(result.current.isViewer(null)).toBe(false);
    expect(result.current.isViewer(undefined)).toBe(false);
    expect(result.current.isViewer('')).toBe(false);
  });
});
