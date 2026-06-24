import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SidebarProvider } from '../../../hooks/useSidebar';

// Control settings.features via a mock.
const mockSettings = vi.fn();
vi.mock('../../../api/settings', () => ({
  useSettings: () => mockSettings(),
}));

import { AdminSidebar } from '../AdminSidebar';

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <MemoryRouter>{children}</MemoryRouter>
    </SidebarProvider>
  );
}

beforeEach(() => {
  mockSettings.mockReturnValue({ data: { features: { dbMaintenance: true } } });
});

describe('AdminSidebar — top-level categories', () => {
  it('promotes Identity & Access to a top-level category (no "Admin" umbrella)', () => {
    render(<AdminSidebar isBuilder />, { wrapper });
    expect(screen.getByText('Identity & Access')).toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('shows Infrastructure as its own top-level category for builders', () => {
    render(<AdminSidebar isBuilder />, { wrapper });
    expect(screen.getByText('Infrastructure')).toBeInTheDocument();
    expect(screen.getByText('Routers')).toBeInTheDocument();
    expect(screen.getByText('Messages')).toBeInTheDocument();
  });
});

describe('AdminSidebar — RBAC preserved', () => {
  it('a non-builder admin sees Identity & Access (Accounts) but NOT Infrastructure', () => {
    render(<AdminSidebar isBuilder={false} />, { wrapper });
    expect(screen.getByText('Identity & Access')).toBeInTheDocument();
    expect(screen.getByText('Accounts')).toBeInTheDocument();
    // Builder-only affordances stay hidden
    expect(screen.queryByText('Infrastructure')).not.toBeInTheDocument();
    expect(screen.queryByText('Roles & Permissions')).not.toBeInTheDocument();
    expect(screen.queryByText('DB Maintenance')).not.toBeInTheDocument();
  });
});

describe('AdminSidebar — DB Maintenance feature flag', () => {
  it('shows DB Maintenance by default (flag true)', () => {
    render(<AdminSidebar isBuilder />, { wrapper });
    expect(screen.getByText('DB Maintenance')).toBeInTheDocument();
  });

  it('shows DB Maintenance when features is absent (default-on)', () => {
    mockSettings.mockReturnValue({ data: {} });
    render(<AdminSidebar isBuilder />, { wrapper });
    expect(screen.getByText('DB Maintenance')).toBeInTheDocument();
  });

  it('hides DB Maintenance when the flag is explicitly false', () => {
    mockSettings.mockReturnValue({ data: { features: { dbMaintenance: false } } });
    render(<AdminSidebar isBuilder />, { wrapper });
    expect(screen.queryByText('DB Maintenance')).not.toBeInTheDocument();
    // Other infrastructure items remain
    expect(screen.getByText('Routers')).toBeInTheDocument();
  });
});
