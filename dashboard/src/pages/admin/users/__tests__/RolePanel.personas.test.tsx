import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Stable spies so we can assert the payloads the panel sends.
const assignMutate = vi.fn();
const unassignMutate = vi.fn();
vi.mock('../../../../api/users', () => ({
  useAddUserRole: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useRemoveUserRole: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../../../api/roles', () => ({
  useRoles: () => ({ data: { roles: ['design', 'review'] } }),
}));
vi.mock('../../../../api/personas', () => ({
  usePersonas: () => ({
    data: {
      personas: [
        { id: 'p1', key: 'production-manager', title: 'Production Manager', description: null, roles: [{ role: 'design', relationship: 'write-all' }], user_count: 1, created_at: '', updated_at: '' },
        { id: 'p2', key: 'fleet-operator', title: 'Fleet Operator', description: null, roles: [], user_count: 0, created_at: '', updated_at: '' },
      ],
    },
  }),
  useUserPersonas: () => ({
    data: {
      personas: [
        { id: 'p1', key: 'production-manager', title: 'Production Manager', description: null, roles: [{ role: 'design', relationship: 'write-all' }], assigned_at: '' },
      ],
      roles: [],
    },
  }),
  useAssignPersona: () => ({ mutate: assignMutate, isPending: false, error: null }),
  useUnassignPersona: () => ({ mutate: unassignMutate, isPending: false, error: null }),
}));

import { RolePanel } from '../RolePanel';

const user = {
  id: 'u1', external_id: 'alice', display_name: 'Alice', email: null,
  status: 'active' as const, metadata: null,
  roles: [
    { role: 'design', type: 'member' as const, read_scope: 'all' as const, write_scope: 'all' as const, granted_by_persona: 'production-manager', created_at: '' },
    { role: 'review', type: 'member' as const, read_scope: 'all' as const, write_scope: 'all' as const, granted_by_persona: null, created_at: '' },
  ],
  created_at: '', updated_at: '',
};

function renderPanel() {
  return render(
    <MemoryRouter>
      <RolePanel user={user} />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('RolePanel — personas (Accounts page)', () => {
  it('lists held personas and unassigns on remove', async () => {
    const u = userEvent.setup();
    renderPanel();

    expect(screen.getByText('Production Manager')).toBeInTheDocument();

    await u.click(screen.getByTitle('Unassign Production Manager'));
    expect(unassignMutate).toHaveBeenCalledWith({ userId: 'u1', key: 'production-manager' });
  });

  it('assigns a persona not yet held', async () => {
    const u = userEvent.setup();
    renderPanel();

    // Held personas are excluded from the picker.
    const picker = screen.getByLabelText('Persona');
    expect(screen.queryByRole('option', { name: 'Production Manager' })).not.toBeInTheDocument();

    await u.selectOptions(picker, 'fleet-operator');
    await u.click(screen.getByRole('button', { name: 'Assign' }));

    expect(assignMutate).toHaveBeenCalledWith(
      { userId: 'u1', key: 'fleet-operator' },
      expect.anything(),
    );
  });

  it('marks persona-sustained memberships with their sustaining persona', () => {
    renderPanel();

    expect(screen.getByTitle('Granted by persona production-manager')).toBeInTheDocument();
    expect(screen.queryByTitle('Granted by persona review')).not.toBeInTheDocument();
  });
});
