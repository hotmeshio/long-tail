import { screen, fireEvent } from '@testing-library/react';
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
vi.mock('../../common/display/UserName', () => ({ UserName: ({ userId }: { userId: string }) => <span>{userId}</span> }));

const ORDER = '6f1c2d3e-0000-4000-8000-000000000001';
const items: EscalationItems = {
  kind: 'accumulate', count: 2, max: 4, pending: [],
  items: [
    { itemKey: ORDER, at: '2026-01-01T00:00:01Z', payload: { stickerCode: 'VC531C38' } },
    { itemKey: 'bag-2', at: '2026-01-01T00:00:02Z' },
  ],
};

const renderPanel = (ui: React.ReactElement) => renderWithProviders(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => { state.remove.mutate.mockReset(); });

describe('EscalationItemsPanel x-lt-item-label', () => {
  it('shows the label, keeps the key as the tooltip, and falls back to the key', () => {
    renderPanel(<EscalationItemsPanel escalationId="e-1" items={items} canWrite={false} labelTemplate="{{item.payload.stickerCode}}" />);
    const [first, second] = screen.getAllByTestId('item-label');
    expect(first.textContent).toBe('VC531C38');
    expect(first).toHaveAttribute('title', ORDER);
    expect(second.textContent).toBe('bag-2');
  });

  it('removes by key while naming the label', () => {
    renderPanel(<EscalationItemsPanel escalationId="e-1" items={items} canWrite labelTemplate="{{item.payload.stickerCode}}" />);
    fireEvent.click(screen.getByLabelText('Remove VC531C38'));
    expect(state.remove.mutate).toHaveBeenCalledWith({ id: 'e-1', itemKey: ORDER });
  });

  it('without a template every item shows its key', () => {
    renderPanel(<EscalationItemsPanel escalationId="e-1" items={items} canWrite={false} />);
    expect(screen.getAllByTestId('item-label').map((e) => e.textContent)).toEqual([ORDER, 'bag-2']);
  });
});
