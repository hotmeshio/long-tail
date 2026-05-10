import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../../api/files', () => ({
  useFileBrowse: vi.fn(),
  useFileMetadata: vi.fn(() => ({ data: null, isLoading: false })),
  useGenerateSignedUrl: vi.fn(() => ({ mutateAsync: vi.fn(), isError: false })),
  useDeleteFile: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false, isError: false })),
  getFilePreviewUrl: (p: string) => `/api/files/${p}`,
  getFileDownloadUrl: (p: string) => `/api/file-browser/download/${p}`,
}));

import { FilesPage } from '../FilesPage';
import { useFileBrowse } from '../../../api/files';

const mockBrowseData = {
  files: [
    { path: 'test-files/hello.txt', size: 35, modified_at: '2026-01-01T00:00:00Z' },
    { path: 'test-files/photo.png', size: 20480, modified_at: '2026-01-02T00:00:00Z' },
  ],
  directories: ['test-files/images/'],
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/files?prefix=test-files/']}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(useFileBrowse).mockReturnValue({
    data: mockBrowseData,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  } as any);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FilesPage', () => {
  it('renders the page header', () => {
    render(<FilesPage />, { wrapper });
    const headings = screen.getAllByText('Files');
    expect(headings.length).toBeGreaterThanOrEqual(1);
    const h1 = headings.find((el) => el.tagName === 'H1');
    expect(h1).toBeTruthy();
  });

  it('renders the search filter input', () => {
    render(<FilesPage />, { wrapper });
    expect(screen.getByPlaceholderText('Filter by prefix...')).toBeInTheDocument();
  });

  it('renders directory entries', () => {
    render(<FilesPage />, { wrapper });
    expect(screen.getByText('images')).toBeInTheDocument();
  });

  it('renders file entries', () => {
    render(<FilesPage />, { wrapper });
    expect(screen.getByText('hello.txt')).toBeInTheDocument();
    expect(screen.getByText('photo.png')).toBeInTheDocument();
  });

  it('shows file sizes', () => {
    render(<FilesPage />, { wrapper });
    expect(screen.getByText('35 B')).toBeInTheDocument();
    expect(screen.getByText('20.0 KB')).toBeInTheDocument();
  });

  it('calls useFileBrowse with current prefix and page size', () => {
    render(<FilesPage />, { wrapper });
    expect(useFileBrowse).toHaveBeenCalledWith('test-files/', 100, undefined);
  });

  it('shows empty state when API returns no results', () => {
    vi.mocked(useFileBrowse).mockReturnValue({
      data: { files: [], directories: [] },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    } as any);
    render(<FilesPage />, { wrapper });
    expect(screen.getByText('This directory is empty')).toBeInTheDocument();
  });

  it('shows loading skeleton', () => {
    vi.mocked(useFileBrowse).mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: false,
      refetch: vi.fn(),
    } as any);
    const { container } = render(<FilesPage />, { wrapper });
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders list view only (no grid toggle)', () => {
    render(<FilesPage />, { wrapper });
    expect(screen.queryByTitle('Grid view')).not.toBeInTheDocument();
    expect(screen.queryByTitle('List view')).not.toBeInTheDocument();
    // Files render in list format
    expect(screen.getByText('hello.txt')).toBeInTheDocument();
  });

  it('shows Next button when nextToken is present', () => {
    vi.mocked(useFileBrowse).mockReturnValue({
      data: { ...mockBrowseData, nextToken: 'abc123' },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    } as any);
    render(<FilesPage />, { wrapper });
    const nextBtn = screen.getByText('Next');
    expect(nextBtn).toBeInTheDocument();
    expect(nextBtn).not.toBeDisabled();
  });

  it('disables Previous on first page', () => {
    vi.mocked(useFileBrowse).mockReturnValue({
      data: { ...mockBrowseData, nextToken: 'abc123' },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    } as any);
    render(<FilesPage />, { wrapper });
    const prevBtn = screen.getByText('Previous');
    expect(prevBtn).toBeDisabled();
  });

  it('shows page size selector', () => {
    render(<FilesPage />, { wrapper });
    expect(screen.getByText('100 / page')).toBeInTheDocument();
  });
});
