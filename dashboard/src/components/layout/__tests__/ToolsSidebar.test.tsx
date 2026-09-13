import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let data: unknown[] | undefined = [];
vi.mock('../../../api/workflows', () => ({ useInvocableWorkflows: () => ({ data }) }));
vi.mock('../../../hooks/useSidebar', () => ({ useSidebar: () => ({ collapsed: false }) }));

import { ToolsSidebar } from '../ToolsSidebar';

function renderNav() {
  return render(<MemoryRouter><ToolsSidebar /></MemoryRouter>);
}

describe('ToolsSidebar', () => {
  it('offers Invoke when the caller has an invokable workflow', () => {
    data = [{ workflow_type: 'fleetTools' }];
    renderNav();
    expect(screen.getByText('Tools')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Invoke/ })).toHaveAttribute('href', '/workflows/durable/invoke');
  });

  it('renders nothing when the list is empty or unloaded', () => {
    data = [];
    const { container } = renderNav();
    expect(container).toBeEmptyDOMElement();
    data = undefined;
    const { container: c2 } = renderNav();
    expect(c2).toBeEmptyDOMElement();
  });
});
