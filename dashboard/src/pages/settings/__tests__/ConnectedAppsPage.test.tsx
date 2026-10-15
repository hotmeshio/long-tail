import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ useConnectedApps: vi.fn(), mutate: vi.fn() }));
vi.mock('../../../api/oauth-server', () => ({
  useConnectedApps: mocks.useConnectedApps,
  useDisconnectApp: () => ({ mutate: mocks.mutate, isPending: false, error: null }),
}));

import { ConnectedAppsPage } from '../ConnectedAppsPage';

const APP = {
  grant_id: 'g1', client_id: 'ltc_1', client_name: 'Claude Code', policy: { preset: 'read_only' }, scope: 'mcp:read',
  created_at: '2026-09-28T00:00:00Z', last_used_at: null,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

beforeEach(() => vi.clearAllMocks());

describe('ConnectedAppsPage', () => {
  it('lists each app with its access', () => {
    mocks.useConnectedApps.mockReturnValue({ data: { grants: [APP, { ...APP, grant_id: 'g2', client_name: 'Desktop', policy: { preset: 'just_me' } }] }, isLoading: false });
    render(<ConnectedAppsPage />, { wrapper });
    expect(screen.getAllByTestId('connected-app')).toHaveLength(2);
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(screen.getByText('As me')).toBeInTheDocument();
  });

  it('says how to connect when there are none', () => {
    mocks.useConnectedApps.mockReturnValue({ data: { grants: [] }, isLoading: false });
    render(<ConnectedAppsPage />, { wrapper });
    expect(screen.getByText(/add this deployment as an MCP server/)).toBeInTheDocument();
  });

  it('disconnects after confirmation', () => {
    mocks.useConnectedApps.mockReturnValue({ data: { grants: [APP] }, isLoading: false });
    render(<ConnectedAppsPage />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(mocks.mutate).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole('button', { name: 'Disconnect' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(mocks.mutate.mock.calls[0][0]).toBe('g1');
  });
});
