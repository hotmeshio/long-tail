import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../../../api/mcp', () => ({
  useMcpServer: vi.fn(() => ({ data: undefined, isLoading: false })),
  useCreateMcpServer: vi.fn(() => ({ mutate: vi.fn(), isPending: false, error: null })),
  useUpdateMcpServer: vi.fn(() => ({ mutate: vi.fn(), isPending: false, error: null })),
  useTestConnection: vi.fn(() => ({ mutate: vi.fn(), isPending: false, data: null })),
}));

import { McpServerDetailPage } from '../McpServerDetailPage';

function wrapper(initialEntry = '/mcp/servers/new?step=1') {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('McpServerDetailPage', () => {
  it('renders page header "Register MCP Server" in new mode', () => {
    render(<McpServerDetailPage />, { wrapper: wrapper() });
    expect(screen.getByText('Register MCP Server')).toBeInTheDocument();
  });

  it('renders step indicator with 4 steps', () => {
    render(<McpServerDetailPage />, { wrapper: wrapper() });
    expect(screen.getByText('Transport')).toBeInTheDocument();
    expect(screen.getByText('Discovery')).toBeInTheDocument();
    expect(screen.getByText('Test')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
  });

  it('shows Transport step by default (step 1)', () => {
    render(<McpServerDetailPage />, { wrapper: wrapper() });
    expect(screen.getByText('Connection Mode')).toBeInTheDocument();
  });

  it('renders name input on step 1', () => {
    render(<McpServerDetailPage />, { wrapper: wrapper() });
    expect(screen.getByPlaceholderText('e.g., vision-server')).toBeInTheDocument();
  });

  it('renders mode cards (In-Process, Network Service, Local Process)', () => {
    render(<McpServerDetailPage />, { wrapper: wrapper() });
    expect(screen.getByText('In-Process')).toBeInTheDocument();
    expect(screen.getByText('Network Service')).toBeInTheDocument();
    expect(screen.getByText('Local Process')).toBeInTheDocument();
  });

  it('disables Next button when name is empty', () => {
    render(<McpServerDetailPage />, { wrapper: wrapper() });
    const nextBtn = screen.getByText('Next');
    expect(nextBtn).toBeDisabled();
  });

  it('shows URL field when Network mode is selected', () => {
    render(<McpServerDetailPage />, { wrapper: wrapper() });
    // Default mode is 'network', so URL field should already be visible
    expect(screen.getByPlaceholderText('https://mcp-server.example.com/sse')).toBeInTheDocument();
  });

  it('shows Command field when Local Process mode is selected', () => {
    render(<McpServerDetailPage />, { wrapper: wrapper() });
    const localBtn = screen.getByText('Local Process');
    fireEvent.click(localBtn);
    expect(screen.getByPlaceholderText('e.g., npx')).toBeInTheDocument();
  });

  it('renders Cancel button', () => {
    render(<McpServerDetailPage />, { wrapper: wrapper() });
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });
});
