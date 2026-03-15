import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { UserName } from '../display/UserName';

vi.mock('../../../api/users', () => ({
  useUser: vi.fn(),
}));

import { useUser } from '../../../api/users';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('UserName', () => {
  it('shows display_name when resolved', () => {
    vi.mocked(useUser).mockReturnValue({
      data: {
        id: 'u-1',
        external_id: 'ext-1',
        email: 'jane@example.com',
        display_name: 'Jane Smith',
        status: 'active',
        metadata: null,
        roles: [],
        created_at: '',
        updated_at: '',
      },
      isLoading: false,
    } as any);

    renderWithProviders(<UserName userId="u-1" />);
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('falls back to email when no display_name', () => {
    vi.mocked(useUser).mockReturnValue({
      data: {
        id: 'u-2',
        external_id: 'ext-2',
        email: 'bob@example.com',
        display_name: null,
        status: 'active',
        metadata: null,
        roles: [],
        created_at: '',
        updated_at: '',
      },
      isLoading: false,
    } as any);

    renderWithProviders(<UserName userId="u-2" />);
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('falls back to external_id when no display_name or email', () => {
    vi.mocked(useUser).mockReturnValue({
      data: {
        id: 'u-3',
        external_id: 'ext-3',
        email: null,
        display_name: null,
        status: 'active',
        metadata: null,
        roles: [],
        created_at: '',
        updated_at: '',
      },
      isLoading: false,
    } as any);

    renderWithProviders(<UserName userId="u-3" />);
    expect(screen.getByText('ext-3')).toBeInTheDocument();
  });

  it('shows truncated ID while loading', () => {
    vi.mocked(useUser).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);

    renderWithProviders(<UserName userId="abcdef12-3456-7890-abcd-ef1234567890" />);
    expect(screen.getByText('abcdef12…')).toBeInTheDocument();
  });

  it('uses custom fallback when provided', () => {
    vi.mocked(useUser).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);

    renderWithProviders(<UserName userId="u-1" fallback="Unknown" />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
});
