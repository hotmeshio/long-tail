import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSubmitGuard, type SubmitGuardDef } from '../useSubmitGuard';

const mockUseEscalations = vi.fn();

vi.mock('../../api/escalations', () => ({
  useEscalations: (...args: unknown[]) => mockUseEscalations(...args),
}));

const GUARD: SubmitGuardDef = {
  query: {
    role: 'print-harvest',
    status: 'pending',
    facets: { walkId: '{{metadata.walkId}}' },
  },
  mustBeEmpty: true,
  message: '{{count}} plates still pending — bag them before closing the walk.',
};

const CTX = { metadata: { walkId: 'walk-7' } };

describe('useSubmitGuard', () => {
  beforeEach(() => {
    mockUseEscalations.mockReset();
    mockUseEscalations.mockReturnValue({ data: { escalations: [], total: 0 } });
  });

  it('is inert without a guard definition — query disabled, never blocked', () => {
    const { result } = renderHook(() => useSubmitGuard(undefined, CTX));
    expect(result.current.blocked).toBe(false);
    expect(mockUseEscalations.mock.calls[0][0].enabled).toBe(false);
  });

  it('interpolates facet tokens against the escalation context', () => {
    renderHook(() => useSubmitGuard(GUARD, CTX));
    const call = mockUseEscalations.mock.calls[0][0];
    expect(call.role).toBe('print-harvest');
    expect(call.status).toBe('pending');
    expect(call.facets.walkId).toBe('walk-7');
    expect(call.enabled).toBe(true);
  });

  it('blocks with the interpolated {{count}} message while rows remain', () => {
    mockUseEscalations.mockReturnValue({ data: { escalations: [{}], total: 3 } });
    const { result } = renderHook(() => useSubmitGuard(GUARD, CTX));
    expect(result.current.blocked).toBe(true);
    expect(result.current.count).toBe(3);
    expect(result.current.message).toBe(
      '3 plates still pending — bag them before closing the walk.',
    );
  });

  it('unblocks the moment the query drains', () => {
    mockUseEscalations.mockReturnValue({ data: { escalations: [], total: 0 } });
    const { result } = renderHook(() => useSubmitGuard(GUARD, CTX));
    expect(result.current.blocked).toBe(false);
    expect(result.current.message).toBe('');
  });

  it('falls back to the default message when none is declared', () => {
    mockUseEscalations.mockReturnValue({ data: { escalations: [{}], total: 2 } });
    const { result } = renderHook(() =>
      useSubmitGuard({ query: { role: 'print-harvest' } }, CTX),
    );
    expect(result.current.message).toBe('2 related items are still pending');
  });
});
