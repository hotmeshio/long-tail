import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/render';
import { ScanSchemeDetailPage } from '../ScanSchemeDetailPage';

// Saving a badge scheme keeps its grant scope: a save that left it out would
// reset a subject-scoped badge to one use per act.
const state = vi.hoisted(() => ({ upsert: vi.fn(), scheme: null as any }));

vi.mock('../../../../api/scan-codes', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useScanScheme: () => ({ data: { scheme: state.scheme, rules: [] }, isLoading: false }),
  useUpsertScanScheme: () => ({ mutate: state.upsert, isPending: false, error: null }),
  useDeleteScanScheme: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

const badge = {
  version: 12, name: 'Associate badge', description: null, target_facet: 'badge_id', encoding: 'delimited',
  delimiter: ':', target_length: null, kind: 'identity', grant_ttl_seconds: 600, grant_max_uses: 0,
  grant_scope: 'subject', enabled: true,
};

function renderPage() {
  renderWithProviders(
    <MemoryRouter initialEntries={['/admin/scan-codes/12']}>
      <Routes><Route path="/admin/scan-codes/:version" element={<ScanSchemeDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.upsert.mockReset();
  state.scheme = { ...badge };
});

describe('ScanSchemeDetailPage — grant scope', () => {
  it('shows the stored scope and saves it with any other change', () => {
    renderPage();
    expect(screen.getByDisplayValue('One held item')).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('Associate badge'), { target: { value: 'Floor badge' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(state.upsert.mock.calls[0][0]).toMatchObject({ name: 'Floor badge', grant_scope: 'subject' });
  });

  it('changing the scope alone is a save', () => {
    renderPage();
    fireEvent.change(screen.getByDisplayValue('One held item'), { target: { value: 'action' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(state.upsert.mock.calls[0][0]).toMatchObject({ grant_scope: 'action' });
  });

  it('a non-identity scheme (here a manufacturer-barcode scheme) has no grant scope control', () => {
    state.scheme = { ...badge, kind: 'action', encoding: 'gtin', grant_ttl_seconds: null, grant_max_uses: 0, grant_scope: 'action', name: 'Shoe' };
    renderPage();
    expect(screen.queryByDisplayValue('One held item')).toBeNull();
  });
});
