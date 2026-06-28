import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Stable mutate spy so we can assert the payload the panel sends.
const addMutate = vi.fn();
vi.mock('../../../../api/users', () => ({
  useAddUserRole: () => ({ mutate: addMutate, isPending: false, error: null }),
  useRemoveUserRole: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../../../api/roles', () => ({
  useRoles: () => ({ data: { roles: ['reviewer', 'customer-triage'] } }),
}));

import { RolePanel } from '../RolePanel';

const user = {
  id: 'u1', external_id: 'alice', display_name: 'Alice', email: null,
  status: 'active' as const, metadata: null, roles: [],
  created_at: '', updated_at: '',
};

beforeEach(() => vi.clearAllMocks());

describe('RolePanel — work-surface scope (Accounts page)', () => {
  it('shows the scope picker for a member and sends read_scope/write_scope on add', async () => {
    const u = userEvent.setup();
    render(<RolePanel user={user} />);

    // Scope picker is present by default (type defaults to member).
    expect(screen.getByLabelText('Work-surface scope')).toBeInTheDocument();

    await u.selectOptions(screen.getByLabelText('Role'), 'customer-triage');
    await u.selectOptions(screen.getByLabelText('Work-surface scope'), 'self|self');
    await u.click(screen.getByRole('button', { name: /add/i }));

    expect(addMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1', role: 'customer-triage', type: 'member',
        read_scope: 'self', write_scope: 'self',
      }),
      expect.anything(),
    );
  });

  it('hides the scope picker for admin and sends all/all', async () => {
    const u = userEvent.setup();
    render(<RolePanel user={user} />);

    await u.selectOptions(screen.getByLabelText('Role type'), 'admin');
    expect(screen.queryByLabelText('Work-surface scope')).not.toBeInTheDocument();

    await u.selectOptions(screen.getByLabelText('Role'), 'reviewer');
    await u.click(screen.getByRole('button', { name: /add/i }));

    expect(addMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'reviewer', type: 'admin', read_scope: 'all', write_scope: 'all',
      }),
      expect.anything(),
    );
  });
});
