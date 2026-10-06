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

describe('EscalationItemsPanel — a shared station', () => {
  it('adds and removes wait behind the badge challenge', async () => {
    const parked: Array<{ verb: string; run: () => void }> = [];
    renderPanel(
      <EscalationItemsPanel
        escalationId="e-1" items={items} canWrite
        guardWrite={(verb, run) => { parked.push({ verb, run }); }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Item key'), { target: { value: 'bag-3' } });
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    fireEvent.click(screen.getByLabelText('Remove bag-1'));
    expect(parked.map((p) => p.verb)).toEqual(['add an item', 'remove an item']);
    expect(state.add.mutate).not.toHaveBeenCalled();
    expect(state.remove.mutate).not.toHaveBeenCalled();

    parked.forEach((p) => p.run());
    await waitFor(() => expect(state.add.mutate).toHaveBeenCalledTimes(1));
    expect(state.remove.mutate).toHaveBeenCalledWith({ id: 'e-1', itemKey: 'bag-1' });
  });
});
