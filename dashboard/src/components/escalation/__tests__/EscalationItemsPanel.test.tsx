import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../test/render';
import { EscalationItemsPanel } from '../EscalationItemsPanel';
import type { EscalationItems } from '../../../lib/escalation-items';

const state = vi.hoisted(() => ({
  add: { mutate: vi.fn(), isPending: false, error: null as Error | null },
  remove: { mutate: vi.fn(), isPending: false, error: null as Error | null },
}));

vi.mock('../../../api/escalations', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAccumulateItem: () => state.add,
  useRemoveAccumulatedItem: () => state.remove,
}));

vi.mock('../../common/display/UserName', () => ({
  UserName: ({ userId }: { userId: string }) => <span>{userId}</span>,
}));

const items: EscalationItems = {
  kind: 'accumulate',
  count: 2,
  max: 4,
  pending: [],
  items: [
    { itemKey: 'bag-1', at: '2026-01-01T00:00:01Z', payload: { weight: 2 }, actor: 'scanner-7' },
    { itemKey: 'bag-2', at: '2026-01-01T00:00:02Z', reciprocalId: 'r-1' },
  ],
};

const renderPanel = (ui: React.ReactElement) => renderWithProviders(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  state.add.mutate.mockReset();
  state.remove.mutate.mockReset();
  state.add.error = null;
});

describe('EscalationItemsPanel', () => {
  it('lists the held items in order with the count against max', () => {
    renderPanel(<EscalationItemsPanel escalationId="e-1" items={items} canWrite={false} />);
    expect(screen.getByTestId('items-headline').textContent).toBe('2 of 4 held');
    const rows = screen.getByTestId('items-list').querySelectorAll('li');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('bag-1');
    expect(rows[0].textContent).toContain('weight: 2');
    expect(rows[0].textContent).toContain('scanner-7');
    expect(screen.getByRole('link', { name: 'linked' })).toHaveAttribute('href', '/escalations/detail/r-1');
    expect(screen.queryByTestId('add-item-form')).toBeNull();
    expect(screen.queryByLabelText(/Remove bag-1/)).toBeNull();
  });

  it('adds an item with a parsed payload and removes one when writable', async () => {
    renderPanel(<EscalationItemsPanel escalationId="e-1" items={items} canWrite />);
    fireEvent.change(screen.getByLabelText('Item key'), { target: { value: 'bag-3' } });
    fireEvent.change(screen.getByLabelText('Item payload'), { target: { value: '{"weight": 5}' } });
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    await waitFor(() => expect(state.add.mutate).toHaveBeenCalledTimes(1));
    expect(state.add.mutate.mock.calls[0][0]).toEqual({ id: 'e-1', itemKey: 'bag-3', payload: { weight: 5 } });

    fireEvent.click(screen.getByLabelText('Remove bag-1'));
    expect(state.remove.mutate).toHaveBeenCalledWith({ id: 'e-1', itemKey: 'bag-1' });
  });

  it('rejects an empty key and a non-object payload before calling the API', () => {
    renderPanel(<EscalationItemsPanel escalationId="e-1" items={items} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/item key is required/i);
    fireEvent.change(screen.getByLabelText('Item key'), { target: { value: 'bag-3' } });
    fireEvent.change(screen.getByLabelText('Item payload'), { target: { value: '[1]' } });
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/JSON object/);
    expect(state.add.mutate).not.toHaveBeenCalled();
  });

  it('disables adding when every slot is held and shows a batch row read-only', () => {
    renderPanel(<EscalationItemsPanel escalationId="e-1" items={{ ...items, count: 4 }} canWrite />);
    expect(screen.getByLabelText('Item key')).toBeDisabled();
    expect(screen.getByText(/Every slot is held/)).toBeTruthy();
  });

  it('renders a batch row with awaiting keys and no controls', () => {
    const batch: EscalationItems = { kind: 'batch', count: 1, max: 3, pending: ['weld', 'paint'], items: [{ itemKey: 'cut', at: '', payload: { ok: true } }] };
    renderPanel(<EscalationItemsPanel escalationId="e-1" items={batch} canWrite />);
    expect(screen.getByTestId('items-headline').textContent).toBe('1 of 3 filled');
    expect(screen.getByText(/Awaiting/).textContent).toContain('weld, paint');
    expect(screen.queryByTestId('add-item-form')).toBeNull();
  });
});
