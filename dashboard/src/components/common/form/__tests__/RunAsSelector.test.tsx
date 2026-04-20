import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('../../../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../BotPicker', () => ({
  BotPicker: ({ selected, onChange }: any) => (
    <select data-testid="bot-picker" value={selected} onChange={(e) => onChange(e.target.value)}>
      <option value="">Default</option>
      <option value="bot-1">Bot 1</option>
    </select>
  ),
}));

import { RunAsSelector } from '../RunAsSelector';
import { useAuth } from '../../../../hooks/useAuth';

describe('RunAsSelector', () => {
  it('renders lavender container for all users', () => {
    vi.mocked(useAuth).mockReturnValue({ user: { displayName: 'Alice' }, isSuperAdmin: false, hasRoleType: () => false } as any);
    const { container } = render(<RunAsSelector selected="" onChange={vi.fn()} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('bg-accent');
    expect(wrapper.className).toContain('border-accent');
  });

  it('shows BotPicker for admin users', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, isSuperAdmin: true, hasRoleType: () => false } as any);
    render(<RunAsSelector selected="" onChange={vi.fn()} />);
    expect(screen.getByTestId('bot-picker')).toBeInTheDocument();
    expect(screen.getByText('Run as')).toBeInTheDocument();
  });

  it('shows BotPicker for users with admin role type', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, isSuperAdmin: false, hasRoleType: (r: string) => r === 'admin' } as any);
    render(<RunAsSelector selected="" onChange={vi.fn()} />);
    expect(screen.getByTestId('bot-picker')).toBeInTheDocument();
  });

  it('shows user display name for non-admin with no bot selected', () => {
    vi.mocked(useAuth).mockReturnValue({ user: { displayName: 'Alice', userId: 'u-1' }, isSuperAdmin: false, hasRoleType: () => false } as any);
    render(<RunAsSelector selected="" onChange={vi.fn()} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText(/Running as/)).toBeInTheDocument();
  });

  it('shows bot external ID for non-admin with bot selected', () => {
    vi.mocked(useAuth).mockReturnValue({ user: { displayName: 'Alice' }, isSuperAdmin: false, hasRoleType: () => false } as any);
    render(<RunAsSelector selected="service-bot" onChange={vi.fn()} />);
    expect(screen.getByText('service-bot')).toBeInTheDocument();
  });

  it('falls back to "you" when no user info', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, isSuperAdmin: false, hasRoleType: () => false } as any);
    render(<RunAsSelector selected="" onChange={vi.fn()} />);
    expect(screen.getByText('you')).toBeInTheDocument();
  });
});
