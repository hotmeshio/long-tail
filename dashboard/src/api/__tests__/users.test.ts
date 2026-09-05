import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';

vi.mock('../client', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../client';
import { USER_QUERY_OPTIONS, useUser, useUserName } from '../users';

const mockFetch = vi.mocked(apiFetch);

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, Wrap: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children) };
}

beforeEach(() => mockFetch.mockReset());

describe('user identity query options', () => {
  it('holds identity for minutes and never refetches on window focus', () => {
    expect(USER_QUERY_OPTIONS.staleTime).toBe(5 * 60_000);
    expect(USER_QUERY_OPTIONS.refetchOnWindowFocus).toBe(false);
  });

  it('useUser applies the identity options to its query', async () => {
    mockFetch.mockResolvedValue({ id: 'u-1', display_name: 'Dana' } as never);
    const { qc, Wrap } = wrapper();
    renderHook(() => useUser('u-1'), { wrapper: Wrap });
    await waitFor(() => expect(qc.getQueryCache().find({ queryKey: ['users', 'u-1'] })).toBeTruthy());
    const opts = qc.getQueryCache().find({ queryKey: ['users', 'u-1'] })!.options as { staleTime?: number };
    expect(opts.staleTime).toBe(5 * 60_000);
  });
});

describe('useUserName batching', () => {
  it('coalesces the tick\'s name lookups into one POST /users/names', async () => {
    mockFetch.mockResolvedValue({
      users: [
        { id: 'a', display_name: 'Ada', external_id: 'a', email: null },
        { id: 'b', display_name: 'Bo', external_id: 'b', email: null },
      ],
    } as never);
    const { Wrap } = wrapper();

    renderHook(() => { useUserName('a'); useUserName('b'); }, { wrapper: Wrap });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const [path, init] = mockFetch.mock.calls[0];
    expect(path).toBe('/users/names');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string).ids.sort()).toEqual(['a', 'b']);
  });
});
