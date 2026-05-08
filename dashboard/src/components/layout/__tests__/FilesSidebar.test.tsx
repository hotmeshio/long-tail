import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { SidebarProvider } from '../../../hooks/useSidebar';

import { FilesSidebar } from '../FilesSidebar';

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <MemoryRouter>{children}</MemoryRouter>
    </SidebarProvider>
  );
}

describe('FilesSidebar', () => {
  it('renders the Storage heading', () => {
    render(<FilesSidebar />, { wrapper });
    expect(screen.getByText('Storage')).toBeInTheDocument();
  });

  it('renders the Files nav link', () => {
    render(<FilesSidebar />, { wrapper });
    expect(screen.getByText('Files')).toBeInTheDocument();
  });

  it('links to /files', () => {
    render(<FilesSidebar />, { wrapper });
    const link = screen.getByText('Files').closest('a');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('/files');
  });
});
