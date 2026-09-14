import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

let query: { data: unknown[] | undefined; isSuccess: boolean } = { data: [], isSuccess: true };
vi.mock('../../../api/workflows', () => ({ useInvocableWorkflows: () => query }));

import { RequireInvocable } from '../RequireInvocable';

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/workflows/durable/invoke']}>
      <Routes>
        <Route path="/" element={<p>home</p>} />
        <Route element={<RequireInvocable />}>
          <Route path="/workflows/durable/invoke" element={<p>invoke page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireInvocable', () => {
  it('sends a caller with nothing to invoke home', () => {
    query = { data: [], isSuccess: true };
    renderGuard();
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('renders the page when the list has entries', () => {
    query = { data: [{ workflow_type: 'x' }], isSuccess: true };
    renderGuard();
    expect(screen.getByText('invoke page')).toBeInTheDocument();
  });

  it('renders the page while the list is still loading', () => {
    query = { data: undefined, isSuccess: false };
    renderGuard();
    expect(screen.getByText('invoke page')).toBeInTheDocument();
  });
});
