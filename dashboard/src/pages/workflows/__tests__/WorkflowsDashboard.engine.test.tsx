import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let engine: any;
const useWorkflowConfigs = vi.fn(() => ({ data: [{ workflow_type: 'certifiedFlow' }] }));
const useDiscoveredWorkflows = vi.fn(() => ({ data: [] }));
const useNamespace = vi.fn(() => ({ namespace: '' }));
const jobs = [
  { workflow_id: 'order-1', entity: 'reviewOrder', status: 'failed', provider_status: 'TERMINATED', is_live: false, created_at: '2026-11-11T10:00:00Z', updated_at: '2026-11-11T10:05:00Z' },
];
vi.mock('../../../hooks/useEngine', () => ({ useEngine: () => engine }));
vi.mock('../../../hooks/useNamespace', () => ({ useNamespace: (...a: unknown[]) => useNamespace(...(a as [])) }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isSuperAdmin: true }) }));
vi.mock('../../../hooks/useEventHooks', () => ({ useWorkflowListEvents: () => undefined }));
vi.mock('../../../api/workflows', () => ({
  useJobs: () => ({ data: { jobs, total: 1 }, isLoading: false, refetch: vi.fn(), isFetching: false }),
  useWorkflowConfigs: (...a: unknown[]) => useWorkflowConfigs(...(a as [])),
  useDiscoveredWorkflows: (...a: unknown[]) => useDiscoveredWorkflows(...(a as [])),
}));

import { WorkflowsDashboard } from '../WorkflowsDashboard';

const renderPage = () => render(<MemoryRouter><WorkflowsDashboard /></MemoryRouter>);

describe('WorkflowsDashboard by engine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists a provider\'s workflows without HotMesh namespace, registry or tiers', () => {
    engine = { provider: 'temporal', native: false, capabilities: { execution: true, terminate: true, list: true }, consoleUrl: null };
    renderPage();
    expect(screen.getByText('order-1')).toBeInTheDocument();
    expect(screen.getByTitle('TERMINATED')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Workflow ID starts with...')).toBeInTheDocument();
    expect(screen.queryByText('Tier')).not.toBeInTheDocument();
    expect(screen.queryByTitle('View config')).not.toBeInTheDocument();
    expect(useNamespace).toHaveBeenCalledWith('namespace', { enabled: false });
    expect(useWorkflowConfigs).toHaveBeenCalledWith({ enabled: false });
    expect(useDiscoveredWorkflows).toHaveBeenCalledWith({ enabled: false });
  });

  it('keeps tiers, registry links and namespaces on HotMesh', () => {
    engine = { provider: 'hotmesh', native: true, capabilities: { execution: true, terminate: true, list: true }, consoleUrl: null };
    renderPage();
    expect(screen.getByText('Tier')).toBeInTheDocument();
    expect(screen.getByTitle('View config')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search workflow ID...')).toBeInTheDocument();
    expect(useNamespace).toHaveBeenCalledWith('namespace', { enabled: true });
  });
});
