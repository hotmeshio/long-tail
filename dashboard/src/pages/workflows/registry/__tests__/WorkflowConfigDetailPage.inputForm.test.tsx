import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// The Input Form is the registry's primary form contract: edited beside a live
// preview, saved as input_schema, with the envelope reduced to metadata.
const mutate = vi.fn();
vi.mock('../../../../api/workflows', () => ({
  useWorkflowConfigs: vi.fn(),
  useUpsertWorkflowConfig: vi.fn(() => ({ mutate, isPending: false, error: null })),
  useDeleteWorkflowConfig: vi.fn(() => ({ mutate: vi.fn(), isPending: false, error: null })),
  useJobs: vi.fn(() => ({ data: { jobs: [] } })),
}));
vi.mock('../../../../api/bots', () => ({ useBots: vi.fn(() => ({ data: { bots: [] } })) }));
vi.mock('../../../../api/roles', () => ({ useRoles: vi.fn(() => ({ data: [] })) }));

import { WorkflowConfigDetailPage } from '../WorkflowConfigDetailPage';
import { useWorkflowConfigs } from '../../../../api/workflows';

const INPUT_SCHEMA = {
  'x-lt-layout': 'two-column',
  required: ['serialNumber'],
  properties: {
    serialNumber: { type: 'string', title: 'Serial number', description: 'Read it off the label' },
    action: { type: 'string', title: 'Tool', enum: ['reprint-label', 'retire'] },
    copies: { type: 'number', title: 'Copies', 'x-lt-showIf': 'input.action=reprint-label' },
  },
};

const config = (input_schema: Record<string, unknown> | null) => ({
  workflow_type: 'fleetTools', description: 'Fleet tools', task_queue: 'long-tail-examples', certified: false,
  invocable: true, default_role: 'reviewer', roles: [], invocation_roles: ['printer-fleet'], consumes: [],
  envelope_schema: { data: {}, metadata: { source: 'dashboard' } }, input_schema, resolver_schema: null,
  cron_schedule: null, execute_as: null,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/workflows/registry/fleetTools']}>
        <Routes><Route path="/workflows/registry/:workflowType" element={<WorkflowConfigDetailPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('WorkflowConfigDetailPage — input form', () => {
  it('shows the declared input form and previews it as the operator\'s form', () => {
    vi.mocked(useWorkflowConfigs).mockReturnValue({ data: [config(INPUT_SCHEMA)], isLoading: false } as any);
    renderPage();
    expect(screen.getByText('Input Form')).toBeInTheDocument();
    expect((screen.getByTestId('input-form-editor') as HTMLTextAreaElement).value).toContain('serialNumber');
    const preview = screen.getByTestId('input-form-preview');
    expect(preview).toHaveTextContent('Serial number');
    expect(preview).toHaveTextContent('Read it off the label');
    expect(screen.queryByLabelText(/Copies/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Tool/), { target: { value: 'reprint-label' } });
    expect(screen.getByLabelText(/Copies/)).toBeInTheDocument();
    expect(screen.getByText('Envelope Metadata')).toBeInTheDocument();
  });

  it('without an input form the envelope keeps its template role', () => {
    vi.mocked(useWorkflowConfigs).mockReturnValue({ data: [config(null)], isLoading: false } as any);
    renderPage();
    expect(screen.getByText('Envelope Schema')).toBeInTheDocument();
    expect(screen.queryByTestId('input-form-preview')).not.toBeInTheDocument();
  });

  it('saves the parsed input form with the rest of the profile', () => {
    vi.mocked(useWorkflowConfigs).mockReturnValue({ data: [config(null)], isLoading: false } as any);
    renderPage();
    fireEvent.change(screen.getByTestId('input-form-editor'), { target: { value: JSON.stringify(INPUT_SCHEMA) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ workflow_type: 'fleetTools', input_schema: INPUT_SCHEMA }), expect.anything());
  });

  it('refuses to save malformed input form JSON', () => {
    vi.mocked(useWorkflowConfigs).mockReturnValue({ data: [config(null)], isLoading: false } as any);
    renderPage();
    fireEvent.change(screen.getByTestId('input-form-editor'), { target: { value: '{nope' } });
    expect(screen.getByText('Invalid JSON')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
