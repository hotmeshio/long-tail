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
  useWorkflowLookups: vi.fn(() => ({ data: undefined })),
  foldWorkflowLookups: (lookups: Array<{ key: string; as?: string; data: unknown; missing?: boolean }>) =>
    Object.fromEntries(lookups.filter((l) => !l.missing).map((l) => [l.as ?? l.key, l.data])),
}));
vi.mock('../../../../api/bots', () => ({ useBots: vi.fn(() => ({ data: { bots: [] } })) }));
vi.mock('../../../../api/roles', () => ({ useRoles: vi.fn(() => ({ data: [] })) }));

import { WorkflowConfigDetailPage } from '../WorkflowConfigDetailPage';
import { useWorkflowConfigs, useWorkflowLookups } from '../../../../api/workflows';

const INPUT_SCHEMA = {
  'x-lt-layout': 'two-column',
  required: ['serialNumber'],
  properties: {
    serialNumber: { type: 'string', title: 'Serial number', description: 'Read it off the label' },
    action: { type: 'string', title: 'Tool', enum: ['reprint-label', 'retire'] },
    copies: { type: 'number', title: 'Copies', 'x-lt-showIf': 'input.action=reprint-label' },
  },
};

const LOOKUP_SCHEMA = {
  required: ['serialNumber'],
  properties: { serialNumber: { type: 'string', title: 'Serial', 'x-lt-options': 'lookup.serials.items' } },
};
const REFS = [{ domain: 'fleet', key: 'serial-numbers', version: 1, as: 'serials' }];

const config = (input_schema: Record<string, unknown> | null, input_lookups: typeof REFS | null = null) => ({
  workflow_type: 'fleetTools', description: 'Fleet tools', task_queue: 'long-tail-examples', certified: false,
  invocable: true, default_role: 'reviewer', roles: [], invocation_roles: ['printer-fleet'], consumes: [],
  envelope_schema: { data: {}, metadata: { source: 'dashboard' } }, input_schema, input_lookups, icon: null,
  resolver_schema: null, cron_schedule: null, execute_as: null,
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

  it('pinned lookups are fetched for the config being edited and feed the preview select', () => {
    vi.mocked(useWorkflowConfigs).mockReturnValue({ data: [config(LOOKUP_SCHEMA, REFS)], isLoading: false } as any);
    vi.mocked(useWorkflowLookups).mockReturnValue({
      data: { lookups: [{ ...REFS[0], data: { items: [{ value: 'sn-1', label: 'Printer 1' }] } }] },
    } as any);
    renderPage();
    expect(useWorkflowLookups).toHaveBeenCalledWith('fleetTools', true);
    expect((screen.getByTestId('input-lookups-editor') as HTMLTextAreaElement).value).toContain('serial-numbers');
    expect(screen.getByRole('option', { name: 'Printer 1' })).toBeInTheDocument();
  });

  it('saves the parsed lookups with the profile and refuses malformed lookup JSON', () => {
    vi.mocked(useWorkflowConfigs).mockReturnValue({ data: [config(null)], isLoading: false } as any);
    renderPage();
    fireEvent.change(screen.getByTestId('input-lookups-editor'), { target: { value: JSON.stringify(REFS) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ input_lookups: REFS }), expect.anything());
    fireEvent.change(screen.getByTestId('input-lookups-editor'), { target: { value: '[nope' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('refuses to save malformed input form JSON', () => {
    vi.mocked(useWorkflowConfigs).mockReturnValue({ data: [config(null)], isLoading: false } as any);
    renderPage();
    fireEvent.change(screen.getByTestId('input-form-editor'), { target: { value: '{nope' } });
    expect(screen.getByText('Invalid JSON')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
