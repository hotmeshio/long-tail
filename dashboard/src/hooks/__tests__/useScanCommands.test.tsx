import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/client', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../../api/client';
import { useScanCommands } from '../useScanCommands';

const mockFetch = vi.mocked(apiFetch);

const scheme = (version: number, extra: Record<string, unknown> = {}) => ({
  version, name: `Scheme ${version}`, target_facet: 'serialNumber', encoding: 'delimited',
  delimiter: ':', target_length: null, kind: 'action', enabled: true, ...extra,
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockImplementation(async (path: string) => {
    if (path === '/scan-codes/schemes') {
      return { schemes: [
        scheme(20),
        scheme(10),
        scheme(30, { kind: 'identity' }),
        scheme(40, { enabled: false }),
      ] };
    }
    if (path === '/scan-codes/schemes/10/actions') {
      return { rules: [
        { category: '3', name: 'Offline', enabled: true },
        { category: '1', name: 'Collect Print', enabled: true },
        { category: '2', name: 'Hidden', enabled: false },
      ] };
    }
    if (path === '/scan-codes/schemes/20/actions') {
      return { rules: [{ category: '0', name: 'Locate', enabled: true }] };
    }
    throw new Error(`unexpected ${path}`);
  });
});

describe('useScanCommands', () => {
  it('flattens enabled rules of enabled action schemes, scheme then category order', async () => {
    const { result } = renderHook(() => useScanCommands(true), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.commands.map((c) => `${c.version}:${c.category} ${c.name}`)).toEqual([
      '10:1 Collect Print',
      '10:3 Offline',
      '20:0 Locate',
    ]);
    expect(result.current.commands[0]).toMatchObject({ schemeName: 'Scheme 10', targetFacet: 'serialNumber', delimiter: ':' });
  });

  it('never asks for identity or disabled schemes', async () => {
    const { result } = renderHook(() => useScanCommands(true), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const paths = mockFetch.mock.calls.map((c) => c[0]);
    expect(paths).not.toContain('/scan-codes/schemes/30/actions');
    expect(paths).not.toContain('/scan-codes/schemes/40/actions');
  });

  it('stays idle when scan input is off', () => {
    const { result } = renderHook(() => useScanCommands(false), { wrapper });
    expect(result.current.commands).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
