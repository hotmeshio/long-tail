import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

// ── Mock data ────────────────────────────────────────────────────────────────

const mockPersonas = [
  {
    id: 'p-1',
    key: 'intake-lead',
    title: 'Intake Lead',
    description: 'Owns the referral intake queue',
    roles: [{ role: 'reviewer' }],
    user_count: 2,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  },
  {
    id: 'p-2',
    key: 'ops-analyst',
    title: 'Ops Analyst',
    description: 'Reads operations analytics',
    roles: [],
    user_count: 0,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  },
];

vi.mock('../../../../api/personas', () => {
  const mutationStub = () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() });
  return {
    usePersonas: () => ({ data: { personas: mockPersonas }, isLoading: false }),
    usePersona: (key: string) => ({
      data: key ? { key, title: 'Intake Lead', roles: [], assignees: [] } : undefined,
    }),
    useAssignPersona: mutationStub,
    useUnassignPersona: mutationStub,
    useCreatePersona: mutationStub,
  };
});

vi.mock('../../../../components/common/form/UserCombobox', () => ({
  UserCombobox: () => <div>user-combobox</div>,
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

// Shell panel mock — a mutable state so tests can simulate open/close.
const mockSetPanel = vi.fn();
const mockClosePanel = vi.fn();
let shellState: { open: boolean; ownerKey: string | null } = { open: false, ownerKey: null };
vi.mock('../../../../hooks/useShellPanel', () => ({
  useShellPanelOptional: () => ({ ...shellState, setPanel: mockSetPanel, closePanel: mockClosePanel }),
}));

import { PersonasPage } from '../PersonasPage';

// ── Helpers ──────────────────────────────────────────────────────────────────

function pageTree() {
  return (
    <MemoryRouter>
      <PersonasPage />
    </MemoryRouter>
  );
}

function lastAssigneesPanelCall() {
  const calls = mockSetPanel.mock.calls.filter(([, opts]) => opts?.key === 'persona-assignees');
  return calls[calls.length - 1];
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PersonasPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shellState = { open: false, ownerKey: null };
  });

  it('renders the table full-width with all personas', () => {
    const { container } = render(pageTree());
    expect(screen.getByRole('heading', { name: 'Personas' })).toBeInTheDocument();
    expect(screen.getByText('Intake Lead')).toBeInTheDocument();
    expect(screen.getByText('Ops Analyst')).toBeInTheDocument();
    // The old reserved right column is gone — the table is the page.
    expect(container.querySelector('[class*="@split"]')).not.toBeInTheDocument();
    expect(screen.queryByText('Assignees')).not.toBeInTheDocument();
  });

  it('opens no panel before an explicit selection', () => {
    render(pageTree());
    expect(lastAssigneesPanelCall()).toBeUndefined();
  });

  it('opens the Assignees panel in the shell when a row is clicked', () => {
    render(pageTree());
    fireEvent.click(screen.getByText('Intake Lead'));
    const call = lastAssigneesPanelCall();
    expect(call).toBeDefined();
    expect(call[1]).toEqual({ key: 'persona-assignees', width: 360 });
    expect((call[0] as ReactElement).props).toMatchObject({ personaKey: 'intake-lead' });
    render(call[0] as ReactElement);
    expect(screen.getByText('Assignees')).toBeInTheDocument();
  });

  it('keeps the row pencil as the config affordance, without opening the panel', () => {
    render(pageTree());
    const pencil = screen.getByTitle('Configure Intake Lead');
    expect(pencil.getAttribute('class')).toContain('text-text-quaternary/70');
    expect(pencil.getAttribute('class')).toContain('hover:text-accent');
    fireEvent.click(pencil);
    expect(mockNavigate).toHaveBeenCalledWith('/admin/personas/intake-lead');
    expect(lastAssigneesPanelCall()).toBeUndefined();
  });

  it('clears the selection when the panel closes via its X', () => {
    const { container } = render(pageTree());
    fireEvent.click(screen.getByText('Intake Lead'));
    expect(container.querySelector('.bg-surface-hover\\/60')).toBeInTheDocument();
    render(lastAssigneesPanelCall()[0] as ReactElement);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(mockClosePanel).toHaveBeenCalledWith('persona-assignees');
    expect(container.querySelector('.bg-surface-hover\\/60')).not.toBeInTheDocument();
  });

  it('clears the selection when the panel is closed externally', () => {
    const view = render(pageTree());
    fireEvent.click(screen.getByText('Intake Lead'));
    // The shell reports our panel open…
    shellState = { open: true, ownerKey: 'persona-assignees' };
    view.rerender(pageTree());
    expect(mockClosePanel).not.toHaveBeenCalledWith('persona-assignees');
    // …then closed: the selection mark clears and the keyed slot is released.
    shellState = { open: false, ownerKey: null };
    view.rerender(pageTree());
    expect(mockClosePanel).toHaveBeenCalledWith('persona-assignees');
    expect(view.container.querySelector('.bg-surface-hover\\/60')).not.toBeInTheDocument();
  });

  it('releases the panel slot on unmount', () => {
    const { unmount } = render(pageTree());
    fireEvent.click(screen.getByText('Intake Lead'));
    unmount();
    expect(mockClosePanel).toHaveBeenCalledWith('persona-assignees');
  });
});
