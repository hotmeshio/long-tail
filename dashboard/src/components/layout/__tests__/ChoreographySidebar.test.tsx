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
  it('renders no choreography section — work lives in Task Queues + the Claimed card', () => {
    const { container } = render(<ChoreographySidebar />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it('retires the generic My Queue / All links', () => {
    render(<ChoreographySidebar />, { wrapper });
    expect(screen.queryByText('My Queue')).not.toBeInTheDocument();
    expect(screen.queryByText('All')).not.toBeInTheDocument();
    expect(screen.queryByText('Pace Board')).not.toBeInTheDocument();
  });

  it('renders nothing when an admin views as operator', () => {
    const { container } = render(<ChoreographySidebar isOps viewAs="operator" />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ChoreographySidebar — builders', () => {
  it('shows Monitor heading with Event Topics, Automations, Capabilities for builders', () => {
    render(<ChoreographySidebar isBuilder />, { wrapper });
    expect(screen.getByText('Monitor')).toBeInTheDocument();
    expect(screen.getByText('Event Topics')).toBeInTheDocument();
    expect(screen.getByText('Automations')).toBeInTheDocument();
    expect(screen.getByText('Capabilities')).toBeInTheDocument();
  });

  it('shows Pace Board then Trend Board first for a builder that can see them', () => {
    render(<ChoreographySidebar isBuilder canSeePaceBoard />, { wrapper });
    const items = screen.getAllByRole('link');
    const labels = items.map((el) => el.textContent?.trim());
    expect(labels[0]).toContain('Pace Board');
    expect(labels[1]).toContain('Trend Board');
  });

  it('engineer builder sees everything but the Pace Board', () => {
    render(<ChoreographySidebar isBuilder />, { wrapper });
    expect(screen.getByText('Event Topics')).toBeInTheDocument();
    expect(screen.getByText('Capabilities')).toBeInTheDocument();
    expect(screen.queryByText('Pace Board')).not.toBeInTheDocument();
  });

  it('shows Agents label when aiEnabled is true', () => {
    render(<ChoreographySidebar isBuilder aiEnabled />, { wrapper });
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.queryByText('Automations')).not.toBeInTheDocument();
  });
});

describe('ChoreographySidebar — ops role (admin, not builder)', () => {
  it('shows Pace Board and Trend Board for admins (can see them)', () => {
    render(<ChoreographySidebar isOps canSeePaceBoard />, { wrapper });
    expect(screen.getByText('Pace Board')).toBeInTheDocument();
    expect(screen.getByText('Trend Board')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Pace Board/ })).toHaveAttribute('href', '/pace');
    expect(screen.getByRole('link', { name: /Trend Board/ })).toHaveAttribute('href', '/trends');
  });

  it('does NOT show Event Topics or Capabilities for isOps-only users', () => {
    render(<ChoreographySidebar isOps canSeePaceBoard />, { wrapper });
    expect(screen.queryByText('Event Topics')).not.toBeInTheDocument();
    expect(screen.queryByText('Capabilities')).not.toBeInTheDocument();
  });
});
