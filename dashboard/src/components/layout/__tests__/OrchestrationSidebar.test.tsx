import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let engine: any;
vi.mock('../../../api/settings', () => ({ useSettings: () => ({ data: { features: { graphWorkflows: false } } }) }));
vi.mock('../../../hooks/useEngine', () => ({ useEngine: () => engine }));
vi.mock('../../../hooks/useSidebar', () => ({ useSidebar: () => ({ collapsed: false }) }));

import { OrchestrationSidebar } from '../OrchestrationSidebar';

const renderSidebar = () => render(<MemoryRouter><OrchestrationSidebar /></MemoryRouter>);
const provider = (list: boolean) => ({ provider: 'temporal', native: false, capabilities: { execution: true, terminate: true, list }, consoleUrl: null });

describe('OrchestrationSidebar', () => {
  it('shows Registry, Invoke and Executions on HotMesh', () => {
    engine = { ...provider(true), provider: 'hotmesh', native: true };
    renderSidebar();
    expect(screen.getByText('Registry')).toBeInTheDocument();
    expect(screen.getByText('Invoke Tool')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Executions/ })).toHaveAttribute('href', '/workflows/executions');
  });

  it('shows only Executions on a provider that lists', () => {
    engine = provider(true);
    renderSidebar();
    expect(screen.getByRole('link', { name: /Executions/ })).toHaveAttribute('href', '/workflows/executions');
    expect(screen.queryByText('Registry')).not.toBeInTheDocument();
    expect(screen.queryByText('Invoke Tool')).not.toBeInTheDocument();
  });

  it('shows nothing on a provider that does not list', () => {
    engine = provider(false);
    const { container } = renderSidebar();
    expect(container).toBeEmptyDOMElement();
  });
});
