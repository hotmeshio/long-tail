import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../api/yaml-workflows', () => ({
  useYamlWorkflow: vi.fn(),
  useYamlWorkflowVersions: vi.fn(),
}));

import { YamlWorkflowDetailPage } from '../YamlWorkflowDetailPage';
import { useYamlWorkflow, useYamlWorkflowVersions } from '../../../api/yaml-workflows';

const flow = {
  id: 'wf-1',
  name: 'hello_world',
  description: 'Greets a name with a message the graph assembles as it runs.',
  app_id: 'graph',
  app_version: '1',
  content_version: 1,
  graph_topic: 'hello_world',
  status: 'active',
  input_schema: { type: 'object', properties: { name: { type: 'string', description: 'Who to greet' } } },
  output_schema: { type: 'object', properties: { greeting: { type: 'string' } } },
  activity_manifest: [],
  yaml_content: 'app:\n  id: graph\n  version: "1"',
  tags: ['example'],
  deployed_at: null,
  activated_at: null,
  execute_as: null,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/mcp/workflows/wf-1']}>
        <Routes>
          <Route path="/mcp/workflows/:id" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.mocked(useYamlWorkflow).mockReturnValue({ data: flow, isLoading: false } as any);
  vi.mocked(useYamlWorkflowVersions).mockReturnValue({ data: { versions: [], total: 0 } } as any);
});

describe('YamlWorkflowDetailPage', () => {
  it('renders the flow topic and key sections', () => {
    render(<YamlWorkflowDetailPage />, { wrapper });
    expect(screen.getAllByText('hello_world').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('Definition')).toBeInTheDocument();
    // input schema field surfaces
    expect(screen.getByText('name')).toBeInTheDocument();
  });

  it('shows loading skeleton while fetching', () => {
    vi.mocked(useYamlWorkflow).mockReturnValue({ data: undefined, isLoading: true } as any);
    const { container } = render(<YamlWorkflowDetailPage />, { wrapper });
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });
});
