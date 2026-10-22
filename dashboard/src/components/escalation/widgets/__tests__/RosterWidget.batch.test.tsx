import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RosterWidget } from '../RosterWidget';
import { EmbedWriteContext } from '../embed-write';
import { ApiError } from '../../../../api/client';

const mockMutateAsync = vi.fn();

vi.mock('../../../../api/escalations', () => ({
  escalationListQuery: () => ({ queryKey: ['unused'], queryFn: () => ({ escalations: [], total: 0 }) }),
  useRosterAction: () => ({ mutateAsync: mockMutateAsync }),
  ROSTER_ACTION_OUTCOMES: { NEEDS_BADGE: 'needs_badge', ROLE_REFUSED: 'role_refused' },
}));
vi.mock('../../../common/display/UserName', () => ({
  UserName: ({ userId }: { userId: string }) => <span>user:{userId}</span>,
}));

const SCHEMA = {
  title: 'Shoes to match',
  'x-lt-widget': 'roster',
  'x-lt-roster': { expected: { batch: true, labels: 'envelope.labels' } },
  'x-lt-columns': [
    { label: 'Shoe', value: '{{item.label.model}}' },
    { label: 'Received', value: '{{item.at}}', format: 'date' },
    { label: 'By', value: '{{item.actor}}', format: 'user' },
  ],
  'x-lt-actions': [
    { label: 'Missing', flag: { label: 'Missing' } },
    { label: 'Found it', unflag: true },
    { label: 'Key in', fill: { payload: { source: 'key-in' }, enterCode: true }, roles: ['manager'] },
  ],
};

const ctx = {
  escalation: { id: 'match-1' },
  metadata: { batch_keys: ['a#1', 'b'], batch_pending: ['b'] },
  envelope: {
    labels: { 'a#1': { model: 'Ace' }, b: { model: 'Bolt' } },
    batch_filled_at: { 'a#1': '2026-10-20T15:14:00.000Z' },
    batch_filled_by: { 'a#1': 'u-rhea' },
    batch_flags: {},
  },
};

function renderWidget(context: Record<string, unknown> = ctx, guard?: Parameters<typeof EmbedWriteContext.Provider>[0]['value']) {
  const client = new QueryClient();
  const widget = <RosterWidget fieldKey="shoes" value="" onChange={vi.fn()} schema={SCHEMA} escalationContext={context} />;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {guard ? <EmbedWriteContext.Provider value={guard}>{widget}</EmbedWriteContext.Provider> : widget}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => mockMutateAsync.mockReset());

describe('RosterWidget on a batch', () => {
  it('shows when each filled entry came in and who filled it', () => {
    renderWidget();
    const filled = screen.getByTestId('roster-entry-a#1');
    expect(filled).toHaveAttribute('data-state', 'in');
    expect(filled).toHaveTextContent('user:u-rhea');
    expect(filled).toHaveTextContent('2026');
    expect(screen.getByTestId('roster-entry-b')).not.toHaveTextContent('user:');
  });

  it('offers flag and key-in on a waiting entry and nothing on an entry that is in', () => {
    renderWidget();
    const offered = screen.getAllByTestId('roster-action-b').map((b) => b.textContent);
    expect(offered).toEqual(['Missing', 'Key in']);
    expect(screen.queryByTestId('roster-action-a#1')).toBeNull();
  });

  it('reads a flagged key as flagged and offers to clear it', () => {
    renderWidget({ ...ctx, envelope: { ...ctx.envelope, batch_flags: { b: { label: 'Missing' } } } });
    expect(screen.getByTestId('roster-state-b')).toHaveTextContent('Missing');
    expect(screen.getByTestId('roster-headline-shoes')).toHaveTextContent('1 of 2 in · 1 Missing');
    expect(screen.getAllByTestId('roster-action-b').map((b) => b.textContent)).toEqual(['Found it', 'Key in']);
  });

  it('runs a flag by pointer', async () => {
    mockMutateAsync.mockResolvedValue({ outcome: 'flagged' });
    renderWidget();
    fireEvent.click(screen.getAllByTestId('roster-action-b')[0]);
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledWith({
      id: 'match-1', field: 'shoes', action: 0, entry: 'b', code: undefined,
    }));
  });

  it('asks for the code in place for a key-in and sends it', async () => {
    mockMutateAsync.mockResolvedValue({ outcome: 'completed' });
    renderWidget();
    fireEvent.click(screen.getAllByTestId('roster-action-b')[1]);
    fireEvent.change(screen.getByTestId('roster-code-b-input'), { target: { value: ' 0812999000028 ' } });
    fireEvent.click(screen.getByTestId('roster-code-b-yes'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledWith({
      id: 'match-1', field: 'shoes', action: 2, entry: 'b', code: '0812999000028',
    }));
  });

  it('asks the page for a badge when the role is missing, then runs again for the badge', async () => {
    const body = { error: 'Key in needs the role: manager.', outcome: 'needs_badge' };
    mockMutateAsync
      .mockRejectedValueOnce(new ApiError(body.error, 403, body))
      .mockResolvedValueOnce({ outcome: 'completed' });
    const calls: Array<{ badge?: string; run: () => Promise<void> }> = [];
    renderWidget(ctx, (_verb, run, options) => { calls.push({ badge: options?.badge, run }); if (!options?.badge) void run(); });
    fireEvent.click(screen.getAllByTestId('roster-action-b')[1]);
    fireEvent.change(screen.getByTestId('roster-code-b-input'), { target: { value: '0812999000028' } });
    fireEvent.click(screen.getByTestId('roster-code-b-yes'));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].badge).toBe('Key in needs the role: manager.');
    expect(screen.getByTestId('roster-error-b')).toHaveTextContent('needs the role: manager');
    await calls[1].run();
    expect(mockMutateAsync).toHaveBeenCalledTimes(2);
    expect(mockMutateAsync.mock.calls[1][0]).toMatchObject({ entry: 'b', code: '0812999000028' });
  });
});
