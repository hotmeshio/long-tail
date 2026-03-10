import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../api/yaml-workflows', () => ({
  useYamlWorkflow: vi.fn(),
  useDeployYamlWorkflow: vi.fn(),
  useActivateYamlWorkflow: vi.fn(),
  useInvokeYamlWorkflow: vi.fn(),
  useArchiveYamlWorkflow: vi.fn(),
  useDeleteYamlWorkflow: vi.fn(),
  useRegenerateYamlWorkflow: vi.fn(),
  useUpdateYamlWorkflow: vi.fn(),
  useYamlWorkflowVersions: vi.fn(() => ({ data: null })),
  useYamlWorkflowVersion: vi.fn(() => ({ data: null })),
}));

vi.mock('../../../api/settings', () => ({
  useSettings: vi.fn(() => ({ data: null })),
}));

import { YamlWorkflowDetailPage } from '../YamlWorkflowDetailPage';
import {
  useYamlWorkflow,
  useDeployYamlWorkflow,
  useActivateYamlWorkflow,
  useInvokeYamlWorkflow,
  useArchiveYamlWorkflow,
  useDeleteYamlWorkflow,
  useRegenerateYamlWorkflow,
  useUpdateYamlWorkflow,
} from '../../../api/yaml-workflows';

// ── Fixtures ──────────────────────────────────────────────────────

const baseMutation = { mutateAsync: vi.fn(), isPending: false, error: null, reset: vi.fn() };

const draftWorkflow = {
  id: 'wf-1',
  name: 'rotate-and-verify',
  description: 'Rotate document, extract info, validate',
  status: 'draft',
  app_id: 'lt-yaml',
  app_version: '1',
  graph_topic: 'rotate_and_verify',
  yaml_content: 'app:\n  id: lt-yaml\n  version: "1"\n',
  activity_manifest: [
    {
      activity_id: 'a0', title: 'Rotate Page', type: 'worker',
      tool_source: 'mcp', mcp_server_id: 'vision', mcp_tool_name: 'rotate_page',
      topic: 'rotate_and_verify-a0', input_mappings: { degrees: '$input.degrees' },
      output_fields: ['rotated_path'],
    },
    {
      activity_id: 'a1', title: 'Extract Info', type: 'worker',
      tool_source: 'mcp', mcp_server_id: 'vision', mcp_tool_name: 'extract_member_info',
      topic: 'rotate_and_verify-a1', input_mappings: { image_ref: '$a0.rotated_path' },
      output_fields: ['member_id', 'name'],
    },
  ],
  input_schema: {
    type: 'object',
    properties: {
      image_ref: { type: 'string' },
      degrees: { type: 'number', default: 180 },
    },
  },
  output_schema: { type: 'object' },
  source_workflow_id: 'triage-123',
  created_at: '2026-03-09T00:00:00Z',
};

const activeWorkflow = { ...draftWorkflow, id: 'wf-2', status: 'active' };
const archivedWorkflow = { ...draftWorkflow, id: 'wf-3', status: 'archived' };

// ── Helpers ───────────────────────────────────────────────────────

function renderPage(wfId = 'wf-1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/mcp/workflows/${wfId}`]}>
        <Routes>
          <Route path="/mcp/workflows/:id" element={<YamlWorkflowDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setupMocks(wf = draftWorkflow) {
  vi.mocked(useYamlWorkflow).mockReturnValue({
    data: wf, isLoading: false, refetch: vi.fn(),
  } as any);
  vi.mocked(useDeployYamlWorkflow).mockReturnValue({ ...baseMutation } as any);
  vi.mocked(useActivateYamlWorkflow).mockReturnValue({ ...baseMutation } as any);
  vi.mocked(useInvokeYamlWorkflow).mockReturnValue({ ...baseMutation } as any);
  vi.mocked(useArchiveYamlWorkflow).mockReturnValue({ ...baseMutation } as any);
  vi.mocked(useDeleteYamlWorkflow).mockReturnValue({ ...baseMutation } as any);
  vi.mocked(useRegenerateYamlWorkflow).mockReturnValue({ ...baseMutation } as any);
  vi.mocked(useUpdateYamlWorkflow).mockReturnValue({ ...baseMutation } as any);
}

// ── Tests ─────────────────────────────────────────────────────────

describe('YamlWorkflowDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  // ── Loading & empty states ──

  it('shows loading skeleton while fetching', () => {
    vi.mocked(useYamlWorkflow).mockReturnValue({
      data: undefined, isLoading: true, refetch: vi.fn(),
    } as any);
    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows not-found message when workflow is null', () => {
    vi.mocked(useYamlWorkflow).mockReturnValue({
      data: null, isLoading: false, refetch: vi.fn(),
    } as any);
    renderPage();
    expect(screen.getByText('Workflow server not found.')).toBeInTheDocument();
  });

  // ── Header & metadata ──

  it('renders workflow name and description', () => {
    renderPage();
    expect(screen.getByText('rotate-and-verify')).toBeInTheDocument();
    expect(screen.getByText('Rotate document, extract info, validate')).toBeInTheDocument();
  });

  it('shows source workflow link', () => {
    renderPage();
    expect(screen.getByText('triage-123')).toBeInTheDocument();
  });

  it('renders field metadata (app id, version, topic, steps)', () => {
    renderPage();
    expect(screen.getByText('lt-yaml')).toBeInTheDocument();
    expect(screen.getByText('rotate_and_verify')).toBeInTheDocument();
    // 2 worker activities — may appear multiple times, so use getAllByText
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
  });

  // ── Pipeline tab ──

  it('renders pipeline strip with step buttons', () => {
    renderPage();
    // Step names appear in both the strip and the detail panel
    expect(screen.getAllByText('Rotate Page').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Extract Info').length).toBeGreaterThanOrEqual(1);
  });

  it('shows step detail when clicking a pipeline step', () => {
    renderPage();
    fireEvent.click(screen.getByText('Extract Info'));
    expect(screen.getByText('vision/extract_member_info')).toBeInTheDocument();
  });

  // ── Config tab ──

  it('shows YAML content on Config tab', () => {
    renderPage();
    fireEvent.click(screen.getByText('Config'));
    expect(screen.getByText(/app:/)).toBeInTheDocument();
    expect(screen.getByText(/id: lt-yaml/)).toBeInTheDocument();
  });

  it('shows YAML Guide link on Config tab', () => {
    renderPage();
    fireEvent.click(screen.getByText('Config'));
    expect(screen.getByText('YAML Guide')).toBeInTheDocument();
  });

  // ── YAML editing (draft only) ──

  it('shows Edit button for draft workflows', () => {
    renderPage();
    fireEvent.click(screen.getByText('Config'));
    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it('does NOT show Edit button for archived workflows', () => {
    setupMocks(archivedWorkflow as any);
    renderPage('wf-3');
    fireEvent.click(screen.getByText('Config'));
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });

  it('switches to editable textarea when Edit is clicked', () => {
    renderPage();
    fireEvent.click(screen.getByText('Config'));
    fireEvent.click(screen.getByText('Edit'));
    // YAML textarea appears (the assistant input is type="text", not textarea)
    const textareas = document.querySelectorAll('textarea');
    expect(textareas.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('reverts to read-only on Cancel', () => {
    renderPage();
    fireEvent.click(screen.getByText('Config'));
    fireEvent.click(screen.getByText('Edit'));

    // Modify the YAML textarea (first textarea on the page)
    const textarea = document.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'modified yaml' } });

    // Cancel
    fireEvent.click(screen.getByText('Cancel'));

    // Should not show Cancel anymore
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    // Original content visible
    expect(screen.getByText(/app:/)).toBeInTheDocument();
  });

  it('calls updateMutation on Save', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    vi.mocked(useUpdateYamlWorkflow).mockReturnValue({
      ...baseMutation, mutateAsync,
    } as any);

    renderPage();
    fireEvent.click(screen.getByText('Config'));
    fireEvent.click(screen.getByText('Edit'));

    // Modify the YAML textarea
    const textarea = document.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'new yaml content' } });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        id: 'wf-1',
        yaml_content: 'new yaml content',
      });
    });
  });

  // ── Lifecycle sidebar ──

  it('shows Deploy button for draft status', () => {
    renderPage();
    expect(screen.getByText('Deploy')).toBeInTheDocument();
  });

  it('treats deployed status as active (deploy auto-activates)', () => {
    setupMocks({ ...draftWorkflow, status: 'deployed' } as any);
    renderPage();
    expect(screen.getByText('Archive')).toBeInTheDocument();
  });

  it('shows Archive button for active status', () => {
    setupMocks(activeWorkflow as any);
    renderPage('wf-2');
    expect(screen.getByText('Archive')).toBeInTheDocument();
  });

  it('shows Delete workflow tool link for draft status', () => {
    renderPage();
    expect(screen.getByText('Delete workflow tool')).toBeInTheDocument();
  });

  it('shows Regenerate button when source workflow exists', () => {
    renderPage();
    expect(screen.getByText('Regenerate')).toBeInTheDocument();
  });

  // ── Invoke tab ──

  it('shows Invoke tab only for active workflows', () => {
    setupMocks(activeWorkflow as any);
    renderPage('wf-2');
    expect(screen.getAllByText('Invoke').length).toBeGreaterThanOrEqual(1);
  });

  it('does not show Invoke tab for draft workflows', () => {
    renderPage();
    expect(screen.queryByText('Invoke')).not.toBeInTheDocument();
  });

  it('renders input form with schema fields on Invoke tab', () => {
    setupMocks(activeWorkflow as any);
    renderPage('wf-2');
    // Click the tab (not the header button)
    const invokeElements = screen.getAllByText('Invoke');
    fireEvent.click(invokeElements[invokeElements.length - 1]);
    expect(screen.getByText('image_ref')).toBeInTheDocument();
    expect(screen.getByText('degrees')).toBeInTheDocument();
  });

  it('can toggle between form and JSON view', () => {
    setupMocks(activeWorkflow as any);
    renderPage('wf-2');
    const invokeElements = screen.getAllByText('Invoke');
    fireEvent.click(invokeElements[invokeElements.length - 1]);
    fireEvent.click(screen.getByText('JSON view'));
    expect(screen.getByText('Form view')).toBeInTheDocument();
  });
});
