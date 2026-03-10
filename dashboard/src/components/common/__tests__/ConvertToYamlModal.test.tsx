import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../api/yaml-workflows', () => ({
  useYamlWorkflowAppIds: vi.fn(),
  useCreateYamlWorkflow: vi.fn(),
}));

import { ConvertToYamlModal } from '../ConvertToYamlModal';
import {
  useYamlWorkflowAppIds,
  useCreateYamlWorkflow,
} from '../../../api/yaml-workflows';

// ── Helpers ───────────────────────────────────────────────────────

function renderModal(props: Partial<Parameters<typeof ConvertToYamlModal>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    isPending: false,
    ...props,
  };
  return {
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ConvertToYamlModal {...defaultProps} />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
    props: defaultProps,
  };
}

function setupMocks() {
  vi.mocked(useYamlWorkflowAppIds).mockReturnValue({
    data: { app_ids: ['testapp', 'myapp'] },
  } as any);
  vi.mocked(useCreateYamlWorkflow).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
    reset: vi.fn(),
  } as any);
}

// ── Tests ─────────────────────────────────────────────────────────

describe('ConvertToYamlModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  // 1. Does not render when open is false
  it('does not render when open is false', () => {
    renderModal({ open: false });
    expect(screen.queryByText('Export as MCP Workflow Tool')).not.toBeInTheDocument();
  });

  // 2. Shows step 1 (namespace selection) initially
  it('shows step 1 (namespace selection) initially', () => {
    renderModal();
    expect(screen.getByText('Export as MCP Workflow Tool')).toBeInTheDocument();
    expect(screen.getAllByText(/Namespace/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByPlaceholderText('e.g. mydbinsights')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
  });

  // 3. Validates namespace format
  it('validates namespace format — shows error for empty after touch', () => {
    renderModal();
    const input = screen.getByPlaceholderText('e.g. mydbinsights');

    // Type something then clear it so the onChange fires with appIdTouched = true
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByText('Namespace is required')).toBeInTheDocument();
  });

  it('validates namespace must start with a lowercase letter', () => {
    renderModal();
    const input = screen.getByPlaceholderText('e.g. mydbinsights');

    // The onChange handler strips non [a-z0-9] so typing "1abc" becomes "1abc"
    fireEvent.change(input, { target: { value: '1abc' } });
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Must start with a lowercase letter')).toBeInTheDocument();
  });

  // 4. Shows existing namespaces in dropdown when typing
  it('shows existing namespaces in dropdown when input is focused', () => {
    renderModal();
    const input = screen.getByPlaceholderText('e.g. mydbinsights');
    fireEvent.focus(input);
    expect(screen.getByText('testapp')).toBeInTheDocument();
    expect(screen.getByText('myapp')).toBeInTheDocument();
  });

  it('filters dropdown options when typing', () => {
    renderModal();
    const input = screen.getByPlaceholderText('e.g. mydbinsights');
    fireEvent.change(input, { target: { value: 'test' } });
    expect(screen.getByText('testapp')).toBeInTheDocument();
    expect(screen.queryByText('myapp')).not.toBeInTheDocument();
  });

  it('selects a namespace from the dropdown', () => {
    renderModal();
    const input = screen.getByPlaceholderText('e.g. mydbinsights');
    fireEvent.focus(input);
    fireEvent.click(screen.getByText('testapp'));
    expect(input).toHaveValue('testapp');
    expect(screen.getByText('Tool will be added to existing namespace.')).toBeInTheDocument();
  });

  // 5. Advances to step 2 when namespace is valid and Next is clicked
  it('advances to step 2 when namespace is valid and Next is clicked', () => {
    renderModal();
    const input = screen.getByPlaceholderText('e.g. mydbinsights');
    fireEvent.change(input, { target: { value: 'newnamespace' } });
    fireEvent.click(screen.getByText('Next'));

    // Step 2 elements
    expect(screen.getByPlaceholderText('e.g. Show Escalated Processes')).toBeInTheDocument();
    expect(screen.getByText(/Tool Name/)).toBeInTheDocument();
  });

  // 6. Step 2 shows tool name and subscribes fields
  it('step 2 shows tool name and subscribes topic fields', () => {
    renderModal();
    // Navigate to step 2
    fireEvent.change(screen.getByPlaceholderText('e.g. mydbinsights'), {
      target: { value: 'testns' },
    });
    fireEvent.click(screen.getByText('Next'));

    expect(screen.getByText(/Tool Name/)).toBeInTheDocument();
    expect(screen.getByText(/Subscribes Topic/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. show-escalated-processes')).toBeInTheDocument();
    expect(screen.getByText('Export')).toBeInTheDocument();
    expect(screen.getByText('Back')).toBeInTheDocument();
  });

  // 7. Auto-derives subscribes from tool name
  it('auto-derives subscribes topic from tool name', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('e.g. mydbinsights'), {
      target: { value: 'testns' },
    });
    fireEvent.click(screen.getByText('Next'));

    const nameInput = screen.getByPlaceholderText('e.g. Show Escalated Processes');
    fireEvent.change(nameInput, { target: { value: 'Show Escalated Processes' } });

    const subscribesInput = screen.getByPlaceholderText('e.g. show-escalated-processes');
    expect(subscribesInput).toHaveValue('show-escalated-processes');
  });

  // 8. Calls onSubmit with correct data when submitted
  it('calls onSubmit with correct data when submitted', () => {
    const { props } = renderModal();

    // Step 1
    fireEvent.change(screen.getByPlaceholderText('e.g. mydbinsights'), {
      target: { value: 'myns' },
    });
    fireEvent.click(screen.getByText('Next'));

    // Step 2
    fireEvent.change(screen.getByPlaceholderText('e.g. Show Escalated Processes'), {
      target: { value: 'My Great Tool' },
    });
    fireEvent.click(screen.getByText('Export'));

    expect(props.onSubmit).toHaveBeenCalledWith({
      name: 'My Great Tool',
      app_id: 'myns',
      subscribes: 'my-great-tool',
    });
  });

  it('does not submit when tool name is empty', () => {
    const { props } = renderModal();

    fireEvent.change(screen.getByPlaceholderText('e.g. mydbinsights'), {
      target: { value: 'myns' },
    });
    fireEvent.click(screen.getByText('Next'));

    // Leave name empty, click Export
    fireEvent.click(screen.getByText('Export'));

    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  // 9. Shows "Exporting..." disabled state when isPending
  it('shows "Exporting..." disabled state when isPending', () => {
    renderModal({ isPending: true });

    // Navigate to step 2
    fireEvent.change(screen.getByPlaceholderText('e.g. mydbinsights'), {
      target: { value: 'myns' },
    });
    fireEvent.click(screen.getByText('Next'));

    fireEvent.change(screen.getByPlaceholderText('e.g. Show Escalated Processes'), {
      target: { value: 'Some Tool' },
    });

    const exportBtn = screen.getByText('Exporting...');
    expect(exportBtn).toBeInTheDocument();
    expect(exportBtn).toBeDisabled();
  });

  // 10. Resets to step 1 when modal is re-opened
  it('resets to step 1 when modal is re-opened', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn();
    const onSubmit = vi.fn();

    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ConvertToYamlModal open={true} onClose={onClose} onSubmit={onSubmit} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Navigate to step 2
    fireEvent.change(screen.getByPlaceholderText('e.g. mydbinsights'), {
      target: { value: 'myns' },
    });
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText(/Tool Name/)).toBeInTheDocument();

    // Close modal
    rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ConvertToYamlModal open={false} onClose={onClose} onSubmit={onSubmit} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Re-open modal
    rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ConvertToYamlModal open={true} onClose={onClose} onSubmit={onSubmit} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Should be back on step 1
    expect(screen.getByPlaceholderText('e.g. mydbinsights')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
    expect(screen.queryByText(/Tool Name/)).not.toBeInTheDocument();
  });

  // Bonus: Back button returns to step 1
  it('navigates back to step 1 when Back is clicked', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('e.g. mydbinsights'), {
      target: { value: 'myns' },
    });
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText(/Tool Name/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByPlaceholderText('e.g. mydbinsights')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
  });

  // Bonus: Shows "new namespace" hint for non-existing namespace
  it('shows new namespace hint for non-existing namespace', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('e.g. mydbinsights'), {
      target: { value: 'brandnew' },
    });
    expect(
      screen.getByText('New namespace — will be created when this tool is exported.'),
    ).toBeInTheDocument();
  });
});
