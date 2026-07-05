import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mock data ────────────────────────────────────────────────────────────────

const reviewerRole = {
  role: 'reviewer', title: 'Reviewer', description: null,
  form_schema: { type: 'object', properties: { approved: { type: 'boolean' } } },
  metadata_schema: null, properties: {},
  ops_visible: false, parent_role: null,
  sla_minutes: null, target_per_hour: null, worker_count: null,
  current_schema_version: 2, upstream_roles: [],
  user_count: 0, chain_count: 0, workflow_count: 0,
};

const versions = {
  versions: [
    { version: 2, has_form_schema: true, has_metadata_schema: false, change_summary: 'Added approved', created_at: '2026-07-01T00:00:00Z', is_current: true },
    { version: 1, has_form_schema: true, has_metadata_schema: false, change_summary: null, created_at: '2026-06-01T00:00:00Z', is_current: false },
  ],
};

// ── Mocks ────────────────────────────────────────────────────────────────────

const mutateFn = vi.fn();

vi.mock('../../../../api/roles', () => ({
  useRoleDetails: () => ({ data: { roles: [reviewerRole] }, isLoading: false }),
  useRoleSchemaVersions: () => ({ data: versions }),
  useRoleSchema: () => ({ data: undefined }),
  useUpdateRole: () => ({ mutate: mutateFn, isPending: false, error: null }),
}));

import { EscalationSchemaPage } from '../EscalationSchemaPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/roles/reviewer/schema']}>
        <Routes>
          <Route path="/admin/roles/:role/schema" element={<EscalationSchemaPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('EscalationSchemaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the title, role, and version in use', () => {
    renderPage();
    expect(screen.getByText('Escalation Schema')).toBeInTheDocument();
    expect(screen.getByText('reviewer')).toBeInTheDocument();
    expect(screen.getByText('v2 in use')).toBeInTheDocument();
  });

  it('seeds the editor from the live schema', () => {
    renderPage();
    const [editor] = screen.getAllByRole('textbox') as HTMLTextAreaElement[];
    expect(editor.value).toContain('"approved"');
  });

  it('lists the version history with the current marker', () => {
    renderPage();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('current')).toBeInTheDocument();
    expect(screen.getByText('Added approved')).toBeInTheDocument();
  });

  it('save is disabled until the schema is edited', () => {
    renderPage();
    expect(screen.getByText('Save Version')).toBeDisabled();
  });

  it('saving sends ONLY the schema and change summary', async () => {
    renderPage();
    const [editor] = screen.getAllByRole('textbox') as HTMLTextAreaElement[];
    await userEvent.clear(editor);
    await userEvent.type(editor, '{{"type": "object"}');
    await userEvent.type(screen.getByPlaceholderText(/lotNumber/), 'Simplified');
    await userEvent.click(screen.getByText('Save Version'));
    expect(mutateFn).toHaveBeenCalledWith(
      { role: 'reviewer', form_schema: { type: 'object' }, change_summary: 'Simplified' },
      expect.anything(),
    );
  });

  it('rejects invalid JSON instead of saving it', async () => {
    renderPage();
    const [editor] = screen.getAllByRole('textbox') as HTMLTextAreaElement[];
    await userEvent.clear(editor);
    await userEvent.type(editor, 'not json');
    expect(screen.getByText('Invalid JSON')).toBeInTheDocument();
    expect(screen.getByText('Save Version')).toBeDisabled();
    expect(mutateFn).not.toHaveBeenCalled();
  });
});
