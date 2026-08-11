import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { RoleDetail } from '../../../../api/roles';

// ── Mock data — one station role with the entity dial set ────────────────────

const printStation: RoleDetail = {
  role: 'print-station',
  title: 'Print Station',
  description: null,
  form_schema: null,
  metadata_schema: null,
  properties: {},
  ops_visible: true,
  ops_home_default: false,
  enforce_schema: false,
  parent_role: null,
  sla_minutes: 30,
  target_per_hour: 20,
  worker_count: 4,
  priority_threshold_minutes: null,
  priority_facet: null,
  entity_facet: 'serialNumber',
  entity_state_source: 'role',
  current_schema_version: null,
  list_schema: null,
  current_list_schema_version: null,
  default_pins: null,
  upstream_roles: [],
  user_count: 0,
  chain_count: 0,
  workflow_count: 0,
};

vi.mock('../../../../api/roles', () => ({
  useRoleDetails: () => ({ data: { roles: [printStation] }, isLoading: false }),
  useUpdateRole: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useDeleteRole: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../../../api/users', () => ({
  useUsers: () => ({ data: { users: [] } }),
}));

import { RoleDetailPage } from '../RoleDetailPage';

// ── Helpers ──────────────────────────────────────────────────────────────────

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderPage(initialEntry = '/admin/roles/print-station') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/admin/roles/:role"
          element={
            <>
              <RoleDetailPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('RoleDetailPage — section sub-nav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the five nav sections', () => {
    renderPage();
    for (const label of ['Identity', 'Pace Board', 'Schemas', 'Members', 'Pins']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('opens on the Identity section by default', () => {
    renderPage();
    // The identity form leads with the display title field.
    expect(screen.getByDisplayValue('Print Station')).toBeInTheDocument();
  });

  it('clicking a section sets ?section= in the URL', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Pace Board' }));
    expect(screen.getByTestId('location-search').textContent).toContain('section=pace-board');
  });

  it('deep-links straight to a section via ?section=', () => {
    renderPage('/admin/roles/print-station?section=pace-board');
    expect(screen.getByText('Show as a station on the Pace Board')).toBeInTheDocument();
  });

  it('falls back to Identity for an unknown ?section= value', () => {
    renderPage('/admin/roles/print-station?section=nonsense');
    expect(screen.getByDisplayValue('Print Station')).toBeInTheDocument();
  });

  it('Pace Board section contains the entity dial inputs', () => {
    renderPage('/admin/roles/print-station?section=pace-board');
    // Entity facet text input, seeded from the role.
    const facetInput = screen.getByPlaceholderText('serialNumber');
    expect(facetInput).toHaveValue('serialNumber');
    // State-source choice: role (Station) vs subtype (Subtypes).
    expect(screen.getByText('States from')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Station' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subtypes' })).toBeInTheDocument();
  });

  it('hides the state-source choice while the entity facet is blank', () => {
    renderPage('/admin/roles/print-station?section=pace-board');
    fireEvent.change(screen.getByPlaceholderText('serialNumber'), { target: { value: '' } });
    expect(screen.queryByText('States from')).not.toBeInTheDocument();
  });
});

describe('Members section — the kiosk toggle', () => {
  it('renders the Station Kiosk group with an unchecked toggle for a plain role', () => {
    renderPage('/admin/roles/print-station?section=members');
    expect(screen.getByText('Station Kiosk')).toBeInTheDocument();
    expect(screen.getByText('Lock single-role members to this queue')).toBeInTheDocument();
    const toggle = screen.getByTitle('Kiosk station viewport');
    expect(toggle.className).not.toContain('bg-accent');
  });

  it('flipping the toggle arms the draft (Save changes) and reads as on', () => {
    renderPage('/admin/roles/print-station?section=members');
    const toggle = screen.getByTitle('Kiosk station viewport');
    fireEvent.click(toggle);
    expect(toggle.className).toContain('bg-accent');
    expect(screen.getByText('Save changes')).toBeInTheDocument();
    // Flip back off — round-trips cleanly.
    fireEvent.click(toggle);
    expect(toggle.className).not.toContain('bg-accent');
  });
});

describe('kiosk property helpers', () => {
  it('read/toggle flip only the kiosk key, preserving the rest of the bag', async () => {
    const { readKioskFlag, toggleKioskFlag } = await import('../role-detail-shared');
    const bag = JSON.stringify({ color: 'blue' }, null, 2);
    expect(readKioskFlag(bag)).toBe(false);
    const on = toggleKioskFlag(bag)!;
    expect(readKioskFlag(on)).toBe(true);
    expect(JSON.parse(on)).toEqual({ color: 'blue', kiosk: true });
    const off = toggleKioskFlag(on)!;
    expect(JSON.parse(off)).toEqual({ color: 'blue' });
  });

  it('leaves an unparseable bag untouched (returns null)', async () => {
    const { toggleKioskFlag } = await import('../role-detail-shared');
    expect(toggleKioskFlag('{not json')).toBeNull();
  });
});
