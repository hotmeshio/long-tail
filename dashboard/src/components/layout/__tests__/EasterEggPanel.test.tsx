import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../../api/settings', () => ({ useSettings: vi.fn() }));

import { useAuth } from '../../../hooks/useAuth';
import { useSettings } from '../../../api/settings';
import { EasterEggPanel } from '../EasterEggPanel';

const mockAuth = vi.mocked(useAuth);
const mockSettings = vi.mocked(useSettings);

function auth({ superadmin = false, admin = false, engineer = false } = {}) {
  return {
    isSuperAdmin: superadmin,
    hasRoleType: (t: string) => (t === 'admin' && admin) || (t === 'superadmin' && superadmin),
    hasRole: (r: string) => r === 'engineer' && engineer,
  } as unknown as ReturnType<typeof useAuth>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.mockReturnValue({ data: { ai: { enabled: false }, branding: {}, environment: {} } } as ReturnType<typeof useSettings>);
});

describe('EasterEggPanel', () => {
  it('offers no Task Queues section — queue views come from membership and pins', () => {
    mockAuth.mockReturnValue(auth({ superadmin: true }));
    render(<EasterEggPanel onClose={vi.fn()} />);
    expect(screen.queryByText('Task Queues')).not.toBeInTheDocument();
  });

  it('shows the AI toggle to every tier', () => {
    mockAuth.mockReturnValue(auth());
    render(<EasterEggPanel onClose={vi.fn()} />);
    expect(screen.getByText('AI features')).toBeInTheDocument();
  });

  it('offers View As only when a lower tier exists to decline into', () => {
    mockAuth.mockReturnValue(auth({ superadmin: true }));
    render(<EasterEggPanel onClose={vi.fn()} />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Operator')).toBeInTheDocument();
  });
});
