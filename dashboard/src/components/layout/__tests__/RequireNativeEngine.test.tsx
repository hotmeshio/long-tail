import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

let settings: { data: unknown; isLoading: boolean } = { data: {}, isLoading: false };
vi.mock('../../../api/settings', () => ({ useSettings: () => settings }));

import { RequireNativeEngine } from '../RequireNativeEngine';

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/admin/streams']}>
      <Routes>
        <Route path="/" element={<p>home</p>} />
        <Route element={<RequireNativeEngine />}>
          <Route path="/admin/streams" element={<p>streams page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireNativeEngine', () => {
  it('sends a deployment on another engine home', () => {
    settings = { data: { engine: { provider: 'temporal', native: false } }, isLoading: false };
    renderGuard();
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('renders the page when HotMesh runs workflows', () => {
    settings = { data: { engine: { provider: 'hotmesh', native: true } }, isLoading: false };
    renderGuard();
    expect(screen.getByText('streams page')).toBeInTheDocument();
  });

  it('renders the page for a server without an engine field', () => {
    settings = { data: {}, isLoading: false };
    renderGuard();
    expect(screen.getByText('streams page')).toBeInTheDocument();
  });

  it('renders nothing while settings load', () => {
    settings = { data: undefined, isLoading: true };
    renderGuard();
    expect(screen.queryByText('home')).not.toBeInTheDocument();
    expect(screen.queryByText('streams page')).not.toBeInTheDocument();
  });
});
