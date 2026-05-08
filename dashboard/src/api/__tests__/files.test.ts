import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { useFileBrowse, useFileMetadata, getFilePreviewUrl, getFileDownloadUrl } from '../files';
import type { BrowseResponse, FileMetadata } from '../files';

const fetchSpy = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
    queryClient,
  };
}

describe('useFileBrowse', () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => vi.restoreAllMocks());

  it('fetches browse endpoint with prefix', async () => {
    const mockData: BrowseResponse = {
      files: [{ path: 'test.txt', size: 10, modified_at: '2026-01-01T00:00:00Z' }],
      directories: ['sub/'],
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(mockData));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useFileBrowse('docs/'), { wrapper });

    await waitFor(() => expect(result.current.data).toBeTruthy());

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain('/file-browser/browse');
    expect(url).toContain('prefix=docs%2F');
  });

  it('fetches with empty prefix for root', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ files: [], directories: [] }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useFileBrowse(''), { wrapper });

    await waitFor(() => expect(result.current.data).toBeTruthy());

    const [url] = fetchSpy.mock.calls[0];
    expect(url).not.toContain('prefix=');
  });

  it('returns parsed files and directories', async () => {
    const mockData: BrowseResponse = {
      files: [
        { path: 'a.png', size: 100, modified_at: '2026-01-01T00:00:00Z' },
        { path: 'b.txt', size: 50, modified_at: '2026-01-02T00:00:00Z' },
      ],
      directories: ['images/', 'docs/'],
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(mockData));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useFileBrowse(''), { wrapper });

    await waitFor(() => expect(result.current.data).toBeTruthy());

    expect(result.current.data!.files).toHaveLength(2);
    expect(result.current.data!.directories).toEqual(['images/', 'docs/']);
  });
});

describe('useFileMetadata', () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => vi.restoreAllMocks());

  it('does not fetch when path is null', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useFileMetadata(null), { wrapper });

    expect(result.current.isFetching).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches metadata when path is provided', async () => {
    const mockMeta: FileMetadata = {
      path: 'test.png',
      size: 1024,
      modified_at: '2026-01-01T00:00:00Z',
      content_type: 'image/png',
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(mockMeta));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useFileMetadata('test.png'), { wrapper });

    await waitFor(() => expect(result.current.data).toBeTruthy());

    expect(result.current.data!.content_type).toBe('image/png');
    expect(result.current.data!.size).toBe(1024);
  });
});

describe('URL utilities', () => {
  it('getFilePreviewUrl strips leading slashes', () => {
    expect(getFilePreviewUrl('/images/test.png')).toBe('/api/files/images/test.png');
    expect(getFilePreviewUrl('images/test.png')).toBe('/api/files/images/test.png');
  });

  it('getFileDownloadUrl strips leading slashes', () => {
    expect(getFileDownloadUrl('/docs/report.pdf')).toBe('/api/file-browser/download/docs/report.pdf');
    expect(getFileDownloadUrl('docs/report.pdf')).toBe('/api/file-browser/download/docs/report.pdf');
  });
});
