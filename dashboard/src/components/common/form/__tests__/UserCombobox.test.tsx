import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The filter must reach the SERVER search (never client-side filtering of a
// paginated list) — capture the params useUsers receives.
const useUsersSpy = vi.fn();
vi.mock('../../../../api/users', () => ({
  useUsers: (params: any) => useUsersSpy(params),
}));
// Identity debounce so typing takes effect immediately under test.
vi.mock('../../../../hooks/useDebouncedValue', () => ({
  useDebouncedValue: (v: unknown) => v,
}));

import { UserCombobox } from '../UserCombobox';

const users = [
  { id: 'u1', external_id: 'ada', display_name: 'Ada Lovelace', email: 'ada@acme.com' },
  { id: 'u2', external_id: 'grace', display_name: 'Grace Hopper', email: 'grace@acme.com' },
];

beforeEach(() => {
  useUsersSpy.mockReset();
  useUsersSpy.mockReturnValue({ data: { users, total: 2 }, isFetching: false });
});

describe('UserCombobox', () => {
  it('sends the typed filter to the server-side account search', async () => {
    const u = userEvent.setup();
    render(<UserCombobox selected={null} onSelect={vi.fn()} />);

    await u.type(screen.getByLabelText('User'), 'ada');

    expect(useUsersSpy).toHaveBeenLastCalledWith({ search: 'ada', limit: 20 });
  });

  it('lists matches and reports the selection', async () => {
    const onSelect = vi.fn();
    const u = userEvent.setup();
    render(<UserCombobox selected={null} onSelect={onSelect} />);

    await u.click(screen.getByLabelText('User'));
    await u.click(screen.getByText('Ada Lovelace'));

    expect(onSelect).toHaveBeenCalledWith({ id: 'u1', label: 'Ada Lovelace' });
  });

  it('hides excluded accounts', async () => {
    const u = userEvent.setup();
    render(<UserCombobox selected={null} onSelect={vi.fn()} excludeIds={['u1']} />);

    await u.click(screen.getByLabelText('User'));

    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
  });

  it('discloses when more matches remain than the page shows', async () => {
    useUsersSpy.mockReturnValue({ data: { users, total: 143 }, isFetching: false });
    const u = userEvent.setup();
    render(<UserCombobox selected={null} onSelect={vi.fn()} />);

    await u.click(screen.getByLabelText('User'));

    expect(screen.getByText('2 of 143 — type to narrow')).toBeInTheDocument();
  });
});
