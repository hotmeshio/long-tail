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

  it('shows Pace Board as the first item for builders', () => {
    render(<ChoreographySidebar isBuilder />, { wrapper });
    const items = screen.getAllByRole('link');
    const labels = items.map((el) => el.textContent?.trim());
    expect(labels[0]).toContain('Pace Board');
  });

  it('shows Agents label when aiEnabled is true', () => {
    render(<ChoreographySidebar isBuilder aiEnabled />, { wrapper });
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.queryByText('Automations')).not.toBeInTheDocument();
  });
});

describe('ChoreographySidebar — ops role (admin, not builder)', () => {
  it('shows Pace Board for isOps users', () => {
    render(<ChoreographySidebar isOps />, { wrapper });
    expect(screen.getByText('Pace Board')).toBeInTheDocument();
  });

  it('does NOT show Event Topics or Capabilities for isOps-only users', () => {
    render(<ChoreographySidebar isOps />, { wrapper });
    expect(screen.queryByText('Event Topics')).not.toBeInTheDocument();
    expect(screen.queryByText('Capabilities')).not.toBeInTheDocument();
  });
});
