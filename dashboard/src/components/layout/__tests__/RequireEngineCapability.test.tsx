import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

let settings: { data: unknown; isLoading: boolean } = { data: {}, isLoading: false };
vi.mock('../../../api/settings', () => ({ useSettings: () => settings }));

import { RequireEngineCapability } from '../RequireEngineCapability';

const engine = (native: boolean, list?: boolean) => ({
  provider: native ? 'hotmesh' : 'dbos',
  native,
  capabilities: { execution: true, terminate: true, ...(list === undefined ? {} : { list }) },
});

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/workflows/executions']}>
      <Routes>
        <Route path="/" element={<p>home</p>} />
        <Route element={<RequireEngineCapability capability="list" />}>
          <Route path="/workflows/executions" element={<p>executions page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireEngineCapability', () => {
  it('renders the page on a provider with the capability', () => {
    settings = { data: { engine: engine(false, true) }, isLoading: false };
    renderGuard();
    expect(screen.getByText('executions page')).toBeInTheDocument();
  });

  it('sends a provider without the capability home', () => {
    settings = { data: { engine: engine(false, false) }, isLoading: false };
    renderGuard();
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('treats a missing flag as absent', () => {
    settings = { data: { engine: engine(false) }, isLoading: false };
    renderGuard();
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('renders the page on HotMesh and on a server without an engine field', () => {
    settings = { data: { engine: engine(true, false) }, isLoading: false };
    renderGuard();
    expect(screen.getByText('executions page')).toBeInTheDocument();
  });

  it('renders nothing while settings load', () => {
    settings = { data: undefined, isLoading: true };
    renderGuard();
    expect(screen.queryByText('home')).not.toBeInTheDocument();
    expect(screen.queryByText('executions page')).not.toBeInTheDocument();
  });
});
