import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { useStationMetrics, useFacetValues } from '../escalations';

const fetchSpy = vi.fn<typeof fetch>();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

const urlOf = () => new URL((fetchSpy.mock.calls[0][0] as string), 'http://local');

beforeEach(() => {
  fetchSpy.mockReset().mockResolvedValue(jsonResponse({ stations: [], values: [] }));
  vi.stubGlobal('fetch', fetchSpy);
  try { sessionStorage.setItem('lt_token', 'tkn'); } catch { /* jsdom */ }
});
afterEach(() => vi.restoreAllMocks());

describe('useStationMetrics — facet scope', () => {
  it('omits the facets param when no scope is bound', async () => {
    const { wrapper } = createWrapper();
    renderHook(() => useStationMetrics('24h'), { wrapper });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const url = urlOf();
    expect(url.pathname).toContain('/escalations/station-metrics');
    expect(url.searchParams.get('period')).toBe('24h');
    expect(url.searchParams.get('facets')).toBeNull();
  });

  it('appends the bound facet scope as a JSON param', async () => {
    const { wrapper } = createWrapper();
    renderHook(() => useStationMetrics('7d', { facility: 'north' }), { wrapper });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const url = urlOf();
    expect(url.searchParams.get('period')).toBe('7d');
    expect(JSON.parse(url.searchParams.get('facets')!)).toEqual({ facility: 'north' });
  });

  it('treats an empty scope object as no filter', async () => {
    const { wrapper } = createWrapper();
    renderHook(() => useStationMetrics('24h', {}), { wrapper });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(urlOf().searchParams.get('facets')).toBeNull();
  });
});

describe('useFacetValues', () => {
  it('requests distinct values for the key', async () => {
    const { wrapper } = createWrapper();
    renderHook(() => useFacetValues('facility'), { wrapper });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const url = urlOf();
    expect(url.pathname).toContain('/escalations/facet-values');
    expect(url.searchParams.get('key')).toBe('facility');
  });

  it('is disabled without a key (no request)', () => {
    const { wrapper } = createWrapper();
    renderHook(() => useFacetValues(null), { wrapper });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
