import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { SidebarProvider } from '../../../hooks/useSidebar';
import { ChoreographySidebar } from '../ChoreographySidebar';

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <MemoryRouter>{children}</MemoryRouter>
    </SidebarProvider>
  );
}

describe('ChoreographySidebar — operators (no builder, no ops)', () => {
  it('shows Work queue entries for plain operators', () => {
    render(<ChoreographySidebar />, { wrapper });
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('My Queue')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
  });

  it('does NOT show Operations or React entries for plain operators', () => {
    render(<ChoreographySidebar />, { wrapper });
    expect(screen.queryByText('Operations')).not.toBeInTheDocument();
    expect(screen.queryByText('Event Topics')).not.toBeInTheDocument();
  });
});

describe('ChoreographySidebar — builders', () => {
  it('shows React heading with Event Topics, Automations, Capabilities for builders', () => {
    render(<ChoreographySidebar isBuilder />, { wrapper });
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('Event Topics')).toBeInTheDocument();
    expect(screen.getByText('Automations')).toBeInTheDocument();
    expect(screen.getByText('Capabilities')).toBeInTheDocument();
  });

  it('shows Operations as the first item for builders', () => {
    render(<ChoreographySidebar isBuilder />, { wrapper });
    const items = screen.getAllByRole('link');
    const labels = items.map((el) => el.textContent?.trim());
    expect(labels[0]).toContain('Operations');
  });

  it('shows Agents label when aiEnabled is true', () => {
    render(<ChoreographySidebar isBuilder aiEnabled />, { wrapper });
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.queryByText('Automations')).not.toBeInTheDocument();
  });
});

describe('ChoreographySidebar — ops role (admin, not builder)', () => {
  it('shows Operations for isOps users', () => {
    render(<ChoreographySidebar isOps />, { wrapper });
    expect(screen.getByText('Operations')).toBeInTheDocument();
  });

  it('does NOT show Event Topics or Capabilities for isOps-only users', () => {
    render(<ChoreographySidebar isOps />, { wrapper });
    expect(screen.queryByText('Event Topics')).not.toBeInTheDocument();
    expect(screen.queryByText('Capabilities')).not.toBeInTheDocument();
  });
});
