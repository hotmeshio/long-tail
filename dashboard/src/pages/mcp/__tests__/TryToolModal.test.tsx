import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TryToolModal } from '../TryToolModal';
import type { McpToolManifest } from '../../../api/types';

vi.mock('../../../api/mcp', () => ({
  useCallMcpTool: vi.fn(),
}));

import { useCallMcpTool } from '../../../api/mcp';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

const baseTool: McpToolManifest = {
  name: 'test_tool',
  description: 'A test tool',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'number', default: 10 },
    },
  },
};

describe('TryToolModal', () => {
  let mutateFn: ReturnType<typeof vi.fn>;
  let resetFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mutateFn = vi.fn();
    resetFn = vi.fn();
    vi.mocked(useCallMcpTool).mockReturnValue({
      mutate: mutateFn,
      reset: resetFn,
      data: null,
      error: null,
      isPending: false,
    } as any);
  });

  it('renders tool name and description', () => {
    renderWithProviders(
      <TryToolModal open serverId="s1" serverName="my-server" tool={baseTool} onClose={vi.fn()} />,
    );
    expect(screen.getByText('my-server / test_tool')).toBeInTheDocument();
    expect(screen.getByText('A test tool')).toBeInTheDocument();
  });

  it('pre-populates skeleton from input schema', () => {
    renderWithProviders(
      <TryToolModal open serverId="s1" serverName="my-server" tool={baseTool} onClose={vi.fn()} />,
    );
    const textarea = screen.getByRole('textbox');
    const parsed = JSON.parse(textarea.textContent || (textarea as HTMLTextAreaElement).value);
    expect(parsed.query).toBe('');
    expect(parsed.limit).toBe(10);
  });

  it('shows Run button initially', () => {
    renderWithProviders(
      <TryToolModal open serverId="s1" serverName="my-server" tool={baseTool} onClose={vi.fn()} />,
    );
    expect(screen.getByText('Run')).toBeInTheDocument();
  });

  it('calls mutate with parsed args on Run', () => {
    renderWithProviders(
      <TryToolModal open serverId="s1" serverName="my-server" tool={baseTool} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('Run'));
    expect(resetFn).toHaveBeenCalled();
    expect(mutateFn).toHaveBeenCalledWith({
      serverId: 's1',
      toolName: 'test_tool',
      arguments: { query: '', limit: 10 },
    });
  });

  it('shows JSON error for invalid input', () => {
    renderWithProviders(
      <TryToolModal open serverId="s1" serverName="my-server" tool={baseTool} onClose={vi.fn()} />,
    );
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'not json' } });
    fireEvent.click(screen.getByText('Run'));
    expect(screen.getByText('Invalid JSON')).toBeInTheDocument();
    expect(mutateFn).not.toHaveBeenCalled();
  });

  it('shows Running... when pending', () => {
    vi.mocked(useCallMcpTool).mockReturnValue({
      mutate: mutateFn,
      reset: resetFn,
      data: null,
      error: null,
      isPending: true,
    } as any);

    renderWithProviders(
      <TryToolModal open serverId="s1" serverName="my-server" tool={baseTool} onClose={vi.fn()} />,
    );
    expect(screen.getByText('Running...')).toBeInTheDocument();
  });

  it('shows Re-run after result', () => {
    vi.mocked(useCallMcpTool).mockReturnValue({
      mutate: mutateFn,
      reset: resetFn,
      data: { result: { ok: true } },
      error: null,
      isPending: false,
    } as any);

    renderWithProviders(
      <TryToolModal open serverId="s1" serverName="my-server" tool={baseTool} onClose={vi.fn()} />,
    );
    expect(screen.getByText('Re-run')).toBeInTheDocument();
  });

  it('shows Re-run after error', () => {
    vi.mocked(useCallMcpTool).mockReturnValue({
      mutate: mutateFn,
      reset: resetFn,
      data: null,
      error: new Error('Server error'),
      isPending: false,
    } as any);

    renderWithProviders(
      <TryToolModal open serverId="s1" serverName="my-server" tool={baseTool} onClose={vi.fn()} />,
    );
    expect(screen.getByText('Re-run')).toBeInTheDocument();
    expect(screen.getByText('Server error')).toBeInTheDocument();
  });

  it('renders nothing when not open', () => {
    const { container } = renderWithProviders(
      <TryToolModal open={false} serverId="s1" serverName="my-server" tool={baseTool} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('calls onClose when Close is clicked', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <TryToolModal open serverId="s1" serverName="my-server" tool={baseTool} onClose={onClose} />,
    );
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
