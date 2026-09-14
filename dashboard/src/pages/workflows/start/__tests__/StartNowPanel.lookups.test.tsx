import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { invocable } from './invoke-test-data';

// A pinned edition that is not available is said so on the page; the field
// that reads it falls back per the x-lt-options rules.
const REF = { domain: 'fleet', key: 'serial-numbers', version: 2, as: 'serials' };
let lookups: Array<Record<string, unknown>> | undefined;
vi.mock('../../../../api/workflows', () => ({
  useWorkflowLookups: () => ({ data: lookups ? { lookups } : undefined }),
  foldWorkflowLookups: (rows: Array<{ key: string; as?: string; data: unknown; missing?: boolean }>) =>
    Object.fromEntries(rows.filter((l) => !l.missing).map((l) => [l.as ?? l.key, l.data])),
  useInvokeWorkflow: () => ({ mutateAsync: vi.fn(), isPending: false, isSuccess: false, error: null, reset: vi.fn() }),
}));
vi.mock('../../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'reviewer' }, isSuperAdmin: false, hasRoleType: () => false }),
}));
vi.mock('../../../../hooks/useAccess', () => ({ useAccess: () => ({ realIsBuilder: false }) }));
vi.mock('../../../../api/bots', () => ({ useBots: () => ({ data: { bots: [] } }) }));
vi.mock('../../../../hooks/useShellPanel', () => ({
  useShellPanelOptional: () => ({ open: false, ownerKey: null, setPanel: vi.fn(), closePanel: vi.fn() }),
}));
vi.mock('../../../../hooks/useEventContext', () => ({
  useEventSubscriptions: () => {},
  useEventStatus: () => ({ connected: true }),
}));

import { StartNowPanel } from '../StartNowPanel';

const FLEET = invocable({
  workflow_type: 'fleetTools',
  input_schema: { required: ['serialNumber'], properties: { serialNumber: { type: 'string', title: 'Serial', 'x-lt-options': 'lookup.serials.items' } } },
  input_lookups: [REF],
});

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><StartNowPanel selected={FLEET} /></MemoryRouter></QueryClientProvider>,
  );
}

describe('StartNowPanel pinned lookups', () => {
  it('names an unavailable edition and lets the field fall back to its plain input', () => {
    lookups = [{ ...REF, data: null, missing: true }];
    renderPanel();
    expect(screen.getByTestId('lookup-missing')).toHaveTextContent('fleet/serial-numbers v2 is not available');
    expect(screen.getByLabelText(/Serial/).tagName).toBe('INPUT');
  });

  it('renders the resolved edition as the select and shows no warning', () => {
    lookups = [{ ...REF, data: { items: [{ value: 'PRN-001', label: 'PRN-001 (north)' }] } }];
    renderPanel();
    expect(screen.queryByTestId('lookup-missing')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'PRN-001 (north)' })).toBeInTheDocument();
  });
});
