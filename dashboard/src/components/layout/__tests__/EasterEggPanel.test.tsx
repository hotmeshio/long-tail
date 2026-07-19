import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../../api/settings', () => ({ useSettings: vi.fn() }));
vi.mock('../../../api/roles', () => ({ useRoleDetails: vi.fn() }));

import { useAuth } from '../../../hooks/useAuth';
import { useSettings } from '../../../api/settings';
import { useRoleDetails } from '../../../api/roles';
import { EasterEggPanel } from '../EasterEggPanel';
import { readTaskQueueRoles } from '../../../lib/task-queues';

const mockAuth = vi.mocked(useAuth);
const mockSettings = vi.mocked(useSettings);
const mockRoles = vi.mocked(useRoleDetails);

function auth({ superadmin = false, admin = false, engineer = false } = {}) {
  return {
    isSuperAdmin: superadmin,
    hasRoleType: (t: string) => (t === 'admin' && admin) || (t === 'superadmin' && superadmin),
    hasRole: (r: string) => r === 'engineer' && engineer,
  } as unknown as ReturnType<typeof useAuth>;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockSettings.mockReturnValue({ data: { ai: { enabled: false }, branding: {}, environment: {} } } as ReturnType<typeof useSettings>);
  mockRoles.mockReturnValue({
    data: {
      roles: [
        { role: 'engineer', title: 'Engineer' },
        { role: 'printer', title: 'Print Farm' },
        { role: 'grinder', title: null },
      ],
    },
  } as unknown as ReturnType<typeof useRoleDetails>);
});

describe('EasterEggPanel — Task Queues section', () => {
  it('does not offer Task Queues to an operator', () => {
    mockAuth.mockReturnValue(auth());
    render(<EasterEggPanel onClose={vi.fn()} />);
    expect(screen.queryByText('Task Queues')).not.toBeInTheDocument();
  });

  it('does not offer Task Queues to an engineer (they get theirs from membership)', () => {
    mockAuth.mockReturnValue(auth({ engineer: true }));
    render(<EasterEggPanel onClose={vi.fn()} />);
    expect(screen.queryByText('Task Queues')).not.toBeInTheDocument();
  });

  it('offers Task Queues to an admin', () => {
    mockAuth.mockReturnValue(auth({ admin: true }));
    render(<EasterEggPanel onClose={vi.fn()} />);
    expect(screen.getByText('Task Queues')).toBeInTheDocument();
  });

  it('lists work-lane roles (excluding capability tiers) and pins on toggle', () => {
    mockAuth.mockReturnValue(auth({ superadmin: true }));
    render(<EasterEggPanel onClose={vi.fn()} />);

    // Open the Task Queues tab.
    fireEvent.click(screen.getByText('Task Queues'));

    // The engineer capability role is filtered out; work lanes are listed.
    expect(screen.getByText('Print Farm')).toBeInTheDocument();
    expect(screen.getByText('grinder')).toBeInTheDocument();
    expect(screen.queryByText('Engineer')).not.toBeInTheDocument();

    // Pin one lane — persists to the shared store.
    fireEvent.click(screen.getByText('Print Farm'));
    expect(readTaskQueueRoles()).toEqual(['printer']);

    // Toggling again unpins.
    fireEvent.click(screen.getByText('Print Farm'));
    expect(readTaskQueueRoles()).toEqual([]);
  });
});
