import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../../api/files', () => ({
  useFileBrowse: vi.fn(),
  useFileMetadata: vi.fn(() => ({ data: null, isLoading: false })),
  useGenerateSignedUrl: vi.fn(() => ({ mutateAsync: vi.fn(), isError: false })),
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
  vi.mocked(useFileBrowse).mockReturnValue({ data: mockBrowseData, isLoading: false } as any);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FilesPage', () => {
  it('renders the page header', () => {
    render(<FilesPage />, { wrapper });
    // "Files" appears in both the PageHeader h1 and the breadcrumbs
    const headings = screen.getAllByText('Files');
    expect(headings.length).toBeGreaterThanOrEqual(1);
    // The h1 element should be present
    const h1 = headings.find((el) => el.tagName === 'H1');
    expect(h1).toBeTruthy();
  });

  it('renders the search filter input', () => {
    render(<FilesPage />, { wrapper });
    expect(screen.getByPlaceholderText('Filter by name...')).toBeInTheDocument();
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

  it('filters files by search term', () => {
    render(<FilesPage />, { wrapper });
    const input = screen.getByPlaceholderText('Filter by name...');
    fireEvent.change(input, { target: { value: 'hello' } });
    // FilterInput has 300ms debounce before calling onChange
    act(() => { vi.advanceTimersByTime(350); });
    expect(screen.getByText('hello.txt')).toBeInTheDocument();
    expect(screen.queryByText('photo.png')).not.toBeInTheDocument();
  });

  it('shows empty state when no files match', () => {
    render(<FilesPage />, { wrapper });
    const input = screen.getByPlaceholderText('Filter by name...');
    fireEvent.change(input, { target: { value: 'zzzznonexistent' } });
    act(() => { vi.advanceTimersByTime(350); });
    expect(screen.getByText('No matching files')).toBeInTheDocument();
  });

  it('shows empty state for empty directory', () => {
    vi.mocked(useFileBrowse).mockReturnValue({
      data: { files: [], directories: [] },
      isLoading: false,
    } as any);
    render(<FilesPage />, { wrapper });
    expect(screen.getByText('This directory is empty')).toBeInTheDocument();
  });

  it('shows loading skeleton', () => {
    vi.mocked(useFileBrowse).mockReturnValue({ data: undefined, isLoading: true } as any);
    const { container } = render(<FilesPage />, { wrapper });
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('shows view toggle when images are present', () => {
    render(<FilesPage />, { wrapper });
    // Grid/list toggle buttons should be rendered
    expect(screen.getByTitle('List view')).toBeInTheDocument();
    expect(screen.getByTitle('Grid view')).toBeInTheDocument();
  });

  it('hides view toggle when no images present', () => {
    vi.mocked(useFileBrowse).mockReturnValue({
      data: {
        files: [{ path: 'doc.txt', size: 10, modified_at: '2026-01-01T00:00:00Z' }],
        directories: [],
      },
      isLoading: false,
    } as any);
    render(<FilesPage />, { wrapper });
    expect(screen.queryByTitle('Grid view')).not.toBeInTheDocument();
  });
});
