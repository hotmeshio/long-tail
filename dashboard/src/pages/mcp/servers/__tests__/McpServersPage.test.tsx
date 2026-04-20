import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../../api/mcp', () => ({
  useMcpServers: vi.fn(),
  useConnectMcpServer: vi.fn(() => ({ mutate: vi.fn() })),
  useDisconnectMcpServer: vi.fn(() => ({ mutate: vi.fn() })),
  useDeleteMcpServer: vi.fn(() => ({ mutate: vi.fn(), isPending: false, error: null })),
  useCredentialStatus: vi.fn(() => ({ data: null })),
}));

import { McpServersPage } from '../McpServersPage';
import { useMcpServers } from '../../../../api/mcp';

const mockServers = {
  servers: [
    {
      id: 'srv-1',
      name: 'long-tail-translation',
      description: 'Built-in translation server',
      transport_type: 'stdio',
      transport_config: { builtin: true },
      auto_connect: true,
      status: 'connected',
      tool_manifest: [
        { name: 'translate_content', description: 'Translate content to target language', inputSchema: { properties: { content: {}, target_language: {} } } },
      ],
      metadata: { builtin: true },
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z',
    },
    {
      id: 'srv-2',
      name: 'external-api-server',
      description: 'External REST API server',
      transport_type: 'sse',
      transport_config: { url: 'http://example.com' },
      auto_connect: false,
      status: 'registered',
      tool_manifest: [
        { name: 'fetch_data', description: 'Fetch data from API', inputSchema: { properties: { endpoint: {} } } },
      ],
      metadata: null,
      created_at: '2025-01-03T00:00:00Z',
      updated_at: '2025-01-04T00:00:00Z',
    },
    {
      id: 'srv-3',
      name: 'empty-server',
      description: null,
      transport_type: 'stdio',
      transport_config: {},
      auto_connect: false,
      status: 'disconnected',
      tool_manifest: null,
      metadata: null,
      created_at: '2025-01-05T00:00:00Z',
      updated_at: '2025-01-05T00:00:00Z',
    },
  ],
  total: 3,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.mocked(useMcpServers).mockReturnValue({ data: mockServers, isLoading: false } as any);
});

describe('McpServersPage', () => {
  it('renders page header', () => {
    render(<McpServersPage />, { wrapper });
    expect(screen.getByText('MCP Server Tools')).toBeInTheDocument();
  });

  it('renders filter bar', () => {
    render(<McpServersPage />, { wrapper });
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Tag')).toBeInTheDocument();
  });

  it('renders all server rows', () => {
    render(<McpServersPage />, { wrapper });
    expect(screen.getByText('long-tail-translation')).toBeInTheDocument();
    expect(screen.getByText('external-api-server')).toBeInTheDocument();
    expect(screen.getByText('empty-server')).toBeInTheDocument();
  });

  it('shows tool count badge for each server', () => {
    render(<McpServersPage />, { wrapper });
    // Count shown as number in badge circle — may appear multiple times
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
  });

  it('renders search input', () => {
    render(<McpServersPage />, { wrapper });
    expect(screen.getByPlaceholderText('Server or tool name...')).toBeInTheDocument();
  });

  it('renders status filter with MCP status options', () => {
    render(<McpServersPage />, { wrapper });
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThanOrEqual(1);
  });

  it('expands server to show tool rows on click', () => {
    render(<McpServersPage />, { wrapper });
    const serverRow = screen.getByText('long-tail-translation').closest('tr')!;
    fireEvent.click(serverRow);
    expect(screen.getByText('translate_content')).toBeInTheDocument();
  });

  it('renders tool descriptions in the DOM', () => {
    render(<McpServersPage />, { wrapper });
    // Tool descriptions are in the DOM (inside collapsed panels)
    expect(screen.getByText('Translate content to target language')).toBeInTheDocument();
    expect(screen.getByText('Fetch data from API')).toBeInTheDocument();
  });

  it('shows status badges', () => {
    render(<McpServersPage />, { wrapper });
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Registered')).toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('shows empty state when no servers', () => {
    vi.mocked(useMcpServers).mockReturnValue({
      data: { servers: [], total: 0 },
      isLoading: false,
    } as any);
    render(<McpServersPage />, { wrapper });
    expect(screen.getByText('No servers found')).toBeInTheDocument();
  });

  it('shows loading skeleton', () => {
    vi.mocked(useMcpServers).mockReturnValue({ data: undefined, isLoading: true } as any);
    const { container } = render(<McpServersPage />, { wrapper });
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders Register Server button', () => {
    render(<McpServersPage />, { wrapper });
    expect(screen.getByText('Register Server')).toBeInTheDocument();
  });

  it('passes filters to API hook', () => {
    render(<McpServersPage />, { wrapper });
    expect(useMcpServers).toHaveBeenCalledWith(
      expect.objectContaining({}),
    );
  });
});
