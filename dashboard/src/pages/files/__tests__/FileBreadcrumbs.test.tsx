import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { FileBreadcrumbs } from '../FileBreadcrumbs';

describe('FileBreadcrumbs', () => {
  it('renders root "Files" label at empty prefix', () => {
    render(<FileBreadcrumbs prefix="" onNavigate={vi.fn()} />);
    expect(screen.getByText('Files')).toBeInTheDocument();
  });

  it('highlights root as active when prefix is empty', () => {
    render(<FileBreadcrumbs prefix="" onNavigate={vi.fn()} />);
    const filesButton = screen.getByText('Files').closest('button')!;
    expect(filesButton.className).toContain('font-medium');
  });

  it('renders breadcrumb segments for nested prefix', () => {
    render(<FileBreadcrumbs prefix="images/screenshots/" onNavigate={vi.fn()} />);
    expect(screen.getByText('Files')).toBeInTheDocument();
    expect(screen.getByText('images')).toBeInTheDocument();
    expect(screen.getByText('screenshots')).toBeInTheDocument();
  });

  it('highlights the last segment as active', () => {
    render(<FileBreadcrumbs prefix="images/screenshots/" onNavigate={vi.fn()} />);
    const lastSegment = screen.getByText('screenshots').closest('button')!;
    expect(lastSegment.className).toContain('font-medium');

    const middleSegment = screen.getByText('images').closest('button')!;
    expect(middleSegment.className).not.toContain('font-medium');
  });

  it('calls onNavigate with empty string when root is clicked', () => {
    const onNavigate = vi.fn();
    render(<FileBreadcrumbs prefix="docs/" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Files'));
    expect(onNavigate).toHaveBeenCalledWith('');
  });

  it('calls onNavigate with correct prefix for middle segment', () => {
    const onNavigate = vi.fn();
    render(<FileBreadcrumbs prefix="a/b/c/" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('b'));
    expect(onNavigate).toHaveBeenCalledWith('a/b/');
  });

  it('handles trailing slashes in prefix', () => {
    render(<FileBreadcrumbs prefix="docs/" onNavigate={vi.fn()} />);
    expect(screen.getByText('docs')).toBeInTheDocument();
  });

  it('renders chevron separators between segments', () => {
    const { container } = render(
      <FileBreadcrumbs prefix="a/b/" onNavigate={vi.fn()} />,
    );
    // ChevronRight renders as an SVG — count separators
    const svgs = container.querySelectorAll('svg');
    // FolderOpen icon + 2 ChevronRight separators = 3 svgs
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });
});
