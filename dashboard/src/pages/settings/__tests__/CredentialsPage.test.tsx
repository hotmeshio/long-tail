import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../api/oauth', () => ({
  useOAuthConnections: vi.fn(),
  useDisconnectOAuth: vi.fn(() => ({ mutate: vi.fn(), isPending: false, error: null })),
}));

vi.mock('../../../api/client', () => ({
  getToken: vi.fn(() => 'test-token'),
}));

import { CredentialsPage } from '../CredentialsPage';
import { useOAuthConnections } from '../../../api/oauth';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CredentialsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page header', () => {
    vi.mocked(useOAuthConnections).mockReturnValue({ data: { connections: [] }, isLoading: false } as any);
    render(<CredentialsPage />, { wrapper });
    expect(screen.getByText('Credentials')).toBeInTheDocument();
  });

  it('renders Add Credential button', () => {
    vi.mocked(useOAuthConnections).mockReturnValue({ data: { connections: [] }, isLoading: false } as any);
    render(<CredentialsPage />, { wrapper });
    expect(screen.getByText('Add Credential')).toBeInTheDocument();
  });

  it('shows empty state when no credentials', () => {
    vi.mocked(useOAuthConnections).mockReturnValue({ data: { connections: [] }, isLoading: false } as any);
    render(<CredentialsPage />, { wrapper });
    expect(screen.getByText('No credentials registered.')).toBeInTheDocument();
  });

  it('renders credential rows', () => {
    vi.mocked(useOAuthConnections).mockReturnValue({
      data: {
        connections: [
          { provider: 'anthropic', label: 'default', email: null, scopes: [], expires_at: null, credential_type: 'oauth_token' },
          { provider: 'anthropic', label: 'work', email: 'user@example.com', scopes: [], expires_at: '2026-12-01', credential_type: 'api_key' },
        ],
      },
      isLoading: false,
    } as any);
    render(<CredentialsPage />, { wrapper });
    // Provider name appears for each connection
    expect(screen.getAllByText('anthropic').length).toBe(2);
    // Non-default label is shown
    expect(screen.getByText('work')).toBeInTheDocument();
    // Credential type badge shown
    expect(screen.getByText('oauth_token')).toBeInTheDocument();
    expect(screen.getByText('api_key')).toBeInTheDocument();
  });

  it('shows loading skeleton', () => {
    vi.mocked(useOAuthConnections).mockReturnValue({ data: undefined, isLoading: true } as any);
    const { container } = render(<CredentialsPage />, { wrapper });
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('opens provider select when Add Credential is clicked', () => {
    vi.mocked(useOAuthConnections).mockReturnValue({ data: { connections: [] }, isLoading: false } as any);
    render(<CredentialsPage />, { wrapper });
    fireEvent.click(screen.getByText('Add Credential'));
    // Provider select and connect button should appear
    expect(screen.getByText('Provider')).toBeInTheDocument();
    expect(screen.getByText('Connect Anthropic')).toBeInTheDocument();
  });

  it('shows revoke confirmation modal when trash is clicked', () => {
    vi.mocked(useOAuthConnections).mockReturnValue({
      data: {
        connections: [
          { provider: 'anthropic', label: 'default', email: null, scopes: [], expires_at: null, credential_type: null },
        ],
      },
      isLoading: false,
    } as any);
    render(<CredentialsPage />, { wrapper });
    // Hover-reveal trash button
    const revokeBtn = screen.getByTitle('Revoke credential');
    fireEvent.click(revokeBtn);
    expect(screen.getByText('Revoke Credential')).toBeInTheDocument();
  });
});
