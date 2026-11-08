import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Stable mutate spies so we can assert the payloads the panel sends.
const addMutate = vi.fn();
const patchMutate = vi.fn();
vi.mock('../../../../api/users', () => ({
  useAddUserRole: () => ({ mutate: addMutate, isPending: false, error: null }),
  useRemoveUserRole: () => ({ mutate: vi.fn(), isPending: false }),
  usePatchUserProperties: () => ({ mutate: patchMutate, isPending: false, error: null }),
  useSystemPropertyKeys: () => ({ data: { keys: ['badge_id'] } }),
}));
vi.mock('../../../../api/roles', () => ({
  useRoles: () => ({ data: { roles: ['reviewer', 'customer-triage'] } }),
}));
vi.mock('../../../../api/personas', () => ({
  usePersonas: () => ({ data: { personas: [] } }),
  useUserPersonas: () => ({ data: { personas: [], roles: [] } }),
  useAssignPersona: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useUnassignPersona: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

const access = vi.hoisted(() => ({ canIssueCredentials: false }));
const reissueMutate = vi.hoisted(() => vi.fn());
vi.mock('../../../../hooks/useAccess', () => ({ useAccess: () => access }));
vi.mock('../../../../components/labels/useBadgeTemplates', () => ({
  useBadgeTemplates: () => [{ name: 'associate-badge', title: 'Associate badge', enabled: true, sensitive: true }],
}));
vi.mock('../../../../api/labels', () => ({
  useReissueBadge: () => ({ mutate: reissueMutate, isPending: false, error: null }),
}));

import { RolePanel } from '../RolePanel';

const user = {
  id: 'u1', external_id: 'alice', display_name: 'Alice', email: null,
  status: 'active' as const, metadata: null, roles: [],
  created_at: '', updated_at: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  access.canIssueCredentials = false;
});

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

describe('RolePanel — properties dictionary', () => {
  const withProps = { ...user, metadata: { shift: 'day' }, identity_bound: ['badge_id'] };

  it('renders the dictionary and shows the badge key as bound, never its value', () => {
    render(<RolePanel user={withProps} />);
    expect(screen.getByText('Properties')).toBeInTheDocument();
    expect(screen.getByText('Credentials')).toBeInTheDocument();
    expect(screen.getByText('badge_id')).toBeInTheDocument();
    expect(screen.getByText('Bound')).toBeInTheDocument();
    expect(screen.getByText('day')).toBeInTheDocument();
  });

  it('shows an unbound identity key as not bound', () => {
    render(<RolePanel user={{ ...user, metadata: {}, identity_bound: [] }} />);
    expect(screen.getByText('Not bound')).toBeInTheDocument();
  });

  it('adding a property sends ONE atomic patch op for the user', async () => {
    const u = userEvent.setup();
    render(<RolePanel user={withProps} />);
    await u.type(screen.getByLabelText('New property name'), 'badge_slug');
    await u.type(screen.getByLabelText('New property value'), 'gluer-june');
    await u.click(screen.getByRole('button', { name: /add property/i }));
    expect(patchMutate).toHaveBeenCalledWith({
      id: 'u1',
      ops: { set: { badge_slug: 'gluer-june' } },
    });
  });
});

describe('RolePanel — badge actions', () => {
  const badged = { ...user, metadata: {}, identity_bound: ['badge_id'] };

  it('offers no badge actions without credential-issuer access', () => {
    render(<RolePanel user={badged} />);
    expect(screen.queryByText('Reissue badge')).toBeNull();
    expect(screen.queryByText('Print badge')).toBeNull();
  });

  it('a credential issuer reissues only after confirming', async () => {
    access.canIssueCredentials = true;
    const u = userEvent.setup();
    render(<RolePanel user={badged} />);
    await u.click(screen.getByText('Reissue badge'));
    expect(reissueMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/stops working now/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Reissue and print' }));
    expect(reissueMutate).toHaveBeenCalledWith(
      { userId: 'u1', template: 'associate-badge', output: 'sheet' },
      expect.any(Object),
    );
  });

  it('Keep closes the confirmation without reissuing', async () => {
    access.canIssueCredentials = true;
    const u = userEvent.setup();
    render(<RolePanel user={badged} />);
    await u.click(screen.getByText('Reissue badge'));
    await u.click(screen.getByRole('button', { name: 'Keep' }));
    expect(reissueMutate).not.toHaveBeenCalled();
    expect(screen.queryByText(/stops working now/)).toBeNull();
  });

  it('an unbound user is offered Issue badge, not Print badge', () => {
    access.canIssueCredentials = true;
    render(<RolePanel user={{ ...user, metadata: {}, identity_bound: [] }} />);
    expect(screen.getByText('Issue badge')).toBeInTheDocument();
    expect(screen.queryByText('Print badge')).toBeNull();
  });
});
