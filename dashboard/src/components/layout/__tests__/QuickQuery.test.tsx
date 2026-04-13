import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockMutate = vi.fn();
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../../api/mcp-query', () => ({
  useSubmitMcpQueryRouted: vi.fn(() => ({
    mutate: mockMutate,
    isPending: false,
  })),
}));

import { QuickQuery } from '../QuickQuery';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('QuickQuery', () => {
  it('renders input with placeholder', () => {
    render(<QuickQuery />, { wrapper });
    expect(screen.getByPlaceholderText('Ask anything...')).toBeInTheDocument();
  });

  it('renders submit button', () => {
    render(<QuickQuery />, { wrapper });
    expect(screen.getByLabelText('Submit query')).toBeInTheDocument();
  });

  it('submit button is disabled when input is empty', () => {
    render(<QuickQuery />, { wrapper });
    const btn = screen.getByLabelText('Submit query');
    expect(btn).toBeDisabled();
  });

  it('submit button is enabled when input has text', () => {
    render(<QuickQuery />, { wrapper });
    const input = screen.getByPlaceholderText('Ask anything...');
    fireEvent.change(input, { target: { value: 'what tasks are pending?' } });
    const btn = screen.getByLabelText('Submit query');
    expect(btn).not.toBeDisabled();
  });

  it('calls mutate on submit', () => {
    render(<QuickQuery />, { wrapper });
    const input = screen.getByPlaceholderText('Ask anything...');
    fireEvent.change(input, { target: { value: 'what tasks are pending?' } });
    fireEvent.submit(input);
    expect(mockMutate).toHaveBeenCalledWith(
      { prompt: 'what tasks are pending?' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    // Simulate onSuccess to verify navigation target
    const onSuccess = mockMutate.mock.calls[0][1].onSuccess;
    onSuccess({ workflow_id: 'wf-123' });
    expect(mockNavigate).toHaveBeenCalledWith('/processes/detail/wf-123');
  });

  it('does not submit when input is empty', () => {
    render(<QuickQuery />, { wrapper });
    const input = screen.getByPlaceholderText('Ask anything...');
    fireEvent.submit(input);
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
