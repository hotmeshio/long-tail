import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SidebarProvider } from '../../../hooks/useSidebar';
import { ChoreographySidebar } from '../../../components/layout/ChoreographySidebar';

const mocks = vi.hoisted(() => ({
  settings: { data: undefined as Record<string, unknown> | undefined, isLoading: false },
}));

vi.mock('../../../api/settings', () => ({ useSettings: () => mocks.settings }));

import { RequireMachines } from '../../../components/layout/RequireMachines';

function navWrapper({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <MemoryRouter>{children}</MemoryRouter>
    </SidebarProvider>
  );
}

function renderGate() {
  return render(
    <MemoryRouter initialEntries={['/lines']}>
      <Routes>
        <Route path="/" element={<p>Home</p>} />
        <Route element={<RequireMachines />}>
          <Route path="/lines" element={<p>Lines page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.settings.data = undefined;
  mocks.settings.isLoading = false;
});

describe('Lines nav entry', () => {
  it('stays absent for ops and builders when the deployment declares no lines', () => {
    render(<ChoreographySidebar isOps canSeePaceBoard />, { wrapper: navWrapper });
    expect(screen.queryByText('Lines')).not.toBeInTheDocument();
    render(<ChoreographySidebar isBuilder canSeePaceBoard />, { wrapper: navWrapper });
    expect(screen.queryByText('Lines')).not.toBeInTheDocument();
  });

  it('renders for ops and builders when lines are declared', () => {
    const { unmount } = render(<ChoreographySidebar isOps canSeePaceBoard showLines />, { wrapper: navWrapper });
    expect(screen.getByText('Lines').closest('a')).toHaveAttribute('href', '/lines');
    unmount();
    render(<ChoreographySidebar isBuilder showLines />, { wrapper: navWrapper });
    expect(screen.getByText('Lines')).toBeInTheDocument();
  });

  it('stays absent for an operator even when lines are declared', () => {
    const { container } = render(<ChoreographySidebar showLines />, { wrapper: navWrapper });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('RequireMachines', () => {
  it('sends the visitor home when settings carry no machines', () => {
    mocks.settings.data = { telemetry: { traceUrl: null } };
    renderGate();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.queryByText('Lines page')).not.toBeInTheDocument();
  });

  it('renders the route when settings carry machines', () => {
    mocks.settings.data = { telemetry: { traceUrl: null }, machines: { lines: [] } };
    renderGate();
    expect(screen.getByText('Lines page')).toBeInTheDocument();
  });

  it('renders nothing while settings load', () => {
    mocks.settings.isLoading = true;
    const { container } = renderGate();
    expect(container).toBeEmptyDOMElement();
  });
});
