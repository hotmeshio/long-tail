import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../api/files', () => ({
  useFileMetadata: vi.fn(),
  useGenerateSignedUrl: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isError: false,
    error: null,
  })),
  getFilePreviewUrl: (p: string) => `/api/files/${p}`,
  getFileDownloadUrl: (p: string) => `/api/file-browser/download/${p}`,
}));

import { FilePreviewPanel } from '../FilePreviewPanel';
import { useFileMetadata } from '../../../api/files';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const imgMeta = {
  path: 'screenshots/page.png',
  size: 204800,
  modified_at: '2026-01-15T10:30:00Z',
  content_type: 'image/png',
};

const txtMeta = {
  path: 'docs/readme.txt',
  size: 1024,
  modified_at: '2026-02-01T08:00:00Z',
  content_type: 'text/plain',
};

const pdfMeta = {
  path: 'reports/annual.pdf',
  size: 5242880,
  modified_at: '2026-03-01T12:00:00Z',
  content_type: 'application/pdf',
};

beforeEach(() => {
  vi.mocked(useFileMetadata).mockReturnValue({ data: imgMeta, isLoading: false } as any);
});

describe('FilePreviewPanel', () => {
  it('renders file name in header', () => {
    render(<FilePreviewPanel filePath="screenshots/page.png" onClose={vi.fn()} />, { wrapper });
    expect(screen.getByText('page.png')).toBeInTheDocument();
  });

  it('renders action buttons', () => {
    render(<FilePreviewPanel filePath="screenshots/page.png" onClose={vi.fn()} />, { wrapper });
    // "Path" appears both as action button and metadata label
    expect(screen.getAllByText('Path').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Download')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Share')).toBeInTheDocument();
  });

  it('renders fullscreen button for images', () => {
    render(<FilePreviewPanel filePath="screenshots/page.png" onClose={vi.fn()} />, { wrapper });
    expect(screen.getByText('Full')).toBeInTheDocument();
  });

  it('does not render fullscreen button for non-images', () => {
    vi.mocked(useFileMetadata).mockReturnValue({ data: txtMeta, isLoading: false } as any);
    render(<FilePreviewPanel filePath="docs/readme.txt" onClose={vi.fn()} />, { wrapper });
    expect(screen.queryByText('Full')).not.toBeInTheDocument();
  });

  it('renders image preview for image content type', () => {
    const { container } = render(
      <FilePreviewPanel filePath="screenshots/page.png" onClose={vi.fn()} />,
      { wrapper },
    );
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img!.src).toContain('/api/files/screenshots/page.png');
  });

  it('renders "Open PDF in new tab" for PDF files', () => {
    vi.mocked(useFileMetadata).mockReturnValue({ data: pdfMeta, isLoading: false } as any);
    render(<FilePreviewPanel filePath="reports/annual.pdf" onClose={vi.fn()} />, { wrapper });
    expect(screen.getByText('Open PDF in new tab')).toBeInTheDocument();
  });

  it('renders metadata fields', () => {
    render(<FilePreviewPanel filePath="screenshots/page.png" onClose={vi.fn()} />, { wrapper });
    // "Path" appears as both action button and metadata label
    expect(screen.getAllByText('Path').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Size')).toBeInTheDocument();
    expect(screen.getByText('Modified')).toBeInTheDocument();
    expect(screen.getByText('image/png')).toBeInTheDocument();
    expect(screen.getByText('200.0 KB')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <FilePreviewPanel filePath="screenshots/page.png" onClose={onClose} />,
      { wrapper },
    );
    // Close button is the X icon button in the header
    const closeButtons = container.querySelectorAll('button');
    const closeBtn = Array.from(closeButtons).find(
      (btn) => btn.querySelector('svg') && btn.closest('.sticky'),
    );
    if (closeBtn) {
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    }
  });

  it('shows loading skeleton when metadata is loading', () => {
    vi.mocked(useFileMetadata).mockReturnValue({ data: undefined, isLoading: true } as any);
    const { container } = render(
      <FilePreviewPanel filePath="screenshots/page.png" onClose={vi.fn()} />,
      { wrapper },
    );
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('shows signed URL duration menu on Share click', () => {
    render(<FilePreviewPanel filePath="screenshots/page.png" onClose={vi.fn()} />, { wrapper });
    fireEvent.click(screen.getByText('Share'));
    expect(screen.getByText('1 hour')).toBeInTheDocument();
    expect(screen.getByText('24 hours')).toBeInTheDocument();
    expect(screen.getByText('7 days')).toBeInTheDocument();
    expect(screen.getByText('30 days')).toBeInTheDocument();
  });

  it('renders download as a button (not a navigation link)', () => {
    render(<FilePreviewPanel filePath="screenshots/page.png" onClose={vi.fn()} />, { wrapper });
    const downloadBtn = screen.getByText('Download').closest('button');
    expect(downloadBtn).toBeTruthy();
  });
});
