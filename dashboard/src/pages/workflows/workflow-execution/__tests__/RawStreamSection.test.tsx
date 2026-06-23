import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { RawStreamSection, parseTimelineKey } from '../RawStreamSection';
import type { WorkflowExecutionEvent } from '../../../../api/types';

const useStreamMessages = vi.fn();
vi.mock('../../../../api/stream-messages', () => ({
  useStreamMessages: (params: { source: string }, options?: unknown) => useStreamMessages(params, options),
}));
vi.mock('../../../admin/streams/StreamMessageDetail', () => ({
  StreamMessageDetail: ({ message }: { message: { id: string } }) => (
    <div data-testid="stream-detail">{message.id}</div>
  ),
}));

const idle = { data: { messages: [], total: 0 }, isFetched: true, isLoading: false, error: null };

function makeEvent(timelineKey: string | undefined): WorkflowExecutionEvent {
  return {
    event_id: 1,
    event_type: 'activity_task_completed',
    category: 'activity',
    event_time: new Date().toISOString(),
    duration_ms: 10,
    is_system: false,
    attributes: { kind: 'activity_task_completed', timeline_key: timelineKey },
  } as WorkflowExecutionEvent;
}

function renderSection(timelineKey: string | undefined) {
  return render(<RawStreamSection jid="wf-1" appId="durable" event={makeEvent(timelineKey)} />);
}

beforeEach(() => {
  useStreamMessages.mockReset();
  useStreamMessages.mockReturnValue(idle);
});

describe('parseTimelineKey', () => {
  it('decomposes a raw dimension path into aid + dad', () => {
    expect(parseTimelineKey('0/0/0/worker')).toEqual({ kind: 'path', aid: 'worker', dad: ',0,0,0' });
    expect(parseTimelineKey('0/0/cycle_hook')).toEqual({ kind: 'path', aid: 'cycle_hook', dad: ',0,0' });
  });
  it('reads the durable proxy ordinal token', () => {
    expect(parseTimelineKey('-proxy-3-')).toEqual({ kind: 'proxyIndex', index: 3 });
  });
  it('rejects other friendly/bare/empty keys', () => {
    expect(parseTimelineKey('-something-')).toBeNull();
    expect(parseTimelineKey('worker')).toBeNull();
    expect(parseTimelineKey('')).toBeNull();
    expect(parseTimelineKey(undefined)).toBeNull();
  });
});

describe('RawStreamSection', () => {
  it('does not fetch until expanded', () => {
    renderSection('0/0/0/worker');
    expect(useStreamMessages).not.toHaveBeenCalled();
  });

  it('raw view: fetches the exact worker row by jid+aid+dad and shows its JSON', () => {
    useStreamMessages.mockImplementation((p: { source: string }) =>
      p.source === 'worker'
        ? { ...idle, data: { messages: [{ id: 'w-9', message: '{}' }], total: 1 } }
        : idle,
    );
    renderSection('0/0/0/worker');
    fireEvent.click(screen.getByText(/Raw stream message/i));

    expect(useStreamMessages).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'worker', jid: 'wf-1', aid: 'worker', dad: ',0,0,0', limit: 1 }),
      undefined,
    );
    expect(screen.getByTestId('stream-detail')).toHaveTextContent('w-9');
    expect(screen.getByText(/Worker stream/i)).toBeInTheDocument();
  });

  it('durable view: maps -proxy-N- to the Nth proxyer row by created order', () => {
    useStreamMessages.mockReturnValue({ ...idle, data: { messages: [{ id: 'p-3', message: '{}' }], total: 1 } });
    renderSection('-proxy-3-');
    fireEvent.click(screen.getByText(/Raw stream message/i));

    expect(useStreamMessages).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'worker', jid: 'wf-1', aid: 'proxyer', sort_by: 'created_at', order: 'asc', offset: 2, limit: 1 }),
      undefined,
    );
    expect(screen.getByTestId('stream-detail')).toHaveTextContent('p-3');
    expect(screen.getByText(/Proxy activity #3/i)).toBeInTheDocument();
  });

  it('raw view: falls back to engine rows matched on metadata for a control activity', () => {
    useStreamMessages.mockImplementation((p: { source: string }) =>
      p.source === 'worker'
        ? idle
        : { ...idle, data: { messages: [{ id: 'e-3', message: JSON.stringify({ metadata: { aid: 'cycle_hook', dad: ',0,0' } }) }], total: 1 } },
    );
    renderSection('0/0/cycle_hook');
    fireEvent.click(screen.getByText(/Raw stream message/i));

    expect(useStreamMessages).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'engine', jid: 'wf-1' }),
      expect.objectContaining({ enabled: true }),
    );
    expect(screen.getByTestId('stream-detail')).toHaveTextContent('e-3');
    expect(screen.getByText(/Engine stream/i)).toBeInTheDocument();
  });

  it('shows a one-line note (no nav) when the activity has no resolvable row', () => {
    renderSection('-something-');
    fireEvent.click(screen.getByText(/Raw stream message/i));
    expect(useStreamMessages).not.toHaveBeenCalled();
    expect(screen.getByText(/No raw stream row maps to this activity/i)).toBeInTheDocument();
  });
});
