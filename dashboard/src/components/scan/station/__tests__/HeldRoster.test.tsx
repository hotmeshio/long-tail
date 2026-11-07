import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The held roster says once when every entry is in, so the hold can end itself.
const mocks = vi.hoisted(() => ({ view: { current: null as unknown } }));

vi.mock('../../../../api/escalations', () => ({
  useEscalation: () => ({
    data: { id: 'tub-row', metadata: { form_schema: { properties: { bags: { type: 'string', 'x-lt-widget': 'roster', 'x-lt-roster': { expected: { batch: true } } } } } } },
  }),
}));
vi.mock('../../../../hooks/useEventHooks', () => ({ useEscalationDetailEvents: () => {} }));
vi.mock('../../../../hooks/useRosters', () => ({ useRosters: () => ({ bags: mocks.view.current }) }));
vi.mock('../../../escalation/widgets/RosterWidget', () => ({ RosterWidget: () => <div data-testid="roster" /> }));

import { HeldRoster } from '../HeldRoster';

const renderRoster = (onAllIn: () => void) => render(
  <QueryClientProvider client={new QueryClient()}>
    <HeldRoster escalationId="tub-row" field="bags" refreshKey={0} onAllIn={onAllIn} />
  </QueryClientProvider>,
);

beforeEach(() => { mocks.view.current = null; });

describe('HeldRoster', () => {
  it('reports all in once every entry is in', () => {
    mocks.view.current = { entries: [{ key: 'a', state: 'in' }, { key: 'b', state: 'in' }] };
    const onAllIn = vi.fn();
    const { rerender } = renderRoster(onAllIn);
    expect(screen.getByTestId('roster')).toBeTruthy();
    expect(onAllIn).toHaveBeenCalledTimes(1);
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <HeldRoster escalationId="tub-row" field="bags" refreshKey={1} onAllIn={onAllIn} />
      </QueryClientProvider>,
    );
    expect(onAllIn).toHaveBeenCalledTimes(1);
  });

  it('stays quiet while an entry waits, while loading, or with nothing expected', () => {
    const onAllIn = vi.fn();
    mocks.view.current = { entries: [{ key: 'a', state: 'in' }, { key: 'b', state: 'waiting' }] };
    renderRoster(onAllIn);
    mocks.view.current = null;
    renderRoster(onAllIn);
    mocks.view.current = { entries: [] };
    renderRoster(onAllIn);
    expect(onAllIn).not.toHaveBeenCalled();
  });
});
