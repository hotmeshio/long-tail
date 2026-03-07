import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { subjectMatchesPattern, NatsProvider, useNatsStatus, useNatsSubscription } from '../useNats';

// ── subjectMatchesPattern (pure function) ───────────────────────────────────

describe('subjectMatchesPattern', () => {
  it('matches exact subjects', () => {
    expect(subjectMatchesPattern('lt.events.task.created', 'lt.events.task.created')).toBe(true);
  });

  it('does not match different subjects', () => {
    expect(subjectMatchesPattern('lt.events.task.created', 'lt.events.task.completed')).toBe(false);
  });

  it('matches with > (match-rest) wildcard', () => {
    expect(subjectMatchesPattern('lt.events.task.created', 'lt.events.>')).toBe(true);
    expect(subjectMatchesPattern('lt.events.escalation.resolved', 'lt.events.>')).toBe(true);
    expect(subjectMatchesPattern('lt.events.workflow.completed', 'lt.>')).toBe(true);
  });

  it('matches with * (single-token) wildcard', () => {
    expect(subjectMatchesPattern('lt.events.task.created', 'lt.events.task.*')).toBe(true);
    expect(subjectMatchesPattern('lt.events.task.completed', 'lt.events.task.*')).toBe(true);
    expect(subjectMatchesPattern('lt.events.task.created', 'lt.events.*.created')).toBe(true);
  });

  it('does not match * across category boundaries', () => {
    expect(subjectMatchesPattern('lt.events.escalation.created', 'lt.events.task.*')).toBe(false);
  });

  it('does not match when subject is shorter than pattern', () => {
    expect(subjectMatchesPattern('lt.events', 'lt.events.task.created')).toBe(false);
  });

  it('does not match when subject is longer than pattern (without wildcards)', () => {
    expect(subjectMatchesPattern('lt.events.task.created', 'lt.events.task')).toBe(false);
  });

  it('matches > at the beginning', () => {
    expect(subjectMatchesPattern('anything.at.all', '>')).toBe(true);
  });

  it('handles single-segment subjects', () => {
    expect(subjectMatchesPattern('test', 'test')).toBe(true);
    expect(subjectMatchesPattern('test', '*')).toBe(true);
    expect(subjectMatchesPattern('test', '>')).toBe(true);
    expect(subjectMatchesPattern('test', 'other')).toBe(false);
  });
});

// ── useNatsStatus ───────────────────────────────────────────────────────────

// Mock the nats.ws module so tests don't require a real NATS server
vi.mock('nats.ws', () => ({
  connect: vi.fn(),
  StringCodec: () => ({
    decode: (data: Uint8Array) => new TextDecoder().decode(data),
    encode: (str: string) => new TextEncoder().encode(str),
  }),
}));

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <NatsProvider>
          {children}
        </NatsProvider>
      </QueryClientProvider>
    );
  };
}

describe('useNatsStatus', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts disconnected when NATS connection fails', async () => {
    const { connect: mockConnect } = await import('nats.ws');
    (mockConnect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('connection refused'));

    const { result } = renderHook(() => useNatsStatus(), {
      wrapper: createWrapper(queryClient),
    });

    // Initially disconnected (connection is async)
    expect(result.current.connected).toBe(false);
  });

  it('reports connected when NATS connects', async () => {
    const { connect: mockConnect } = await import('nats.ws');

    const mockSub = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise(() => {}), // hang forever
      }),
      unsubscribe: vi.fn(),
    };

    const mockStatus = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise(() => {}),
      }),
    };

    const mockNc = {
      subscribe: vi.fn().mockReturnValue(mockSub),
      status: vi.fn().mockReturnValue(mockStatus),
      close: vi.fn().mockResolvedValue(undefined),
    };

    (mockConnect as ReturnType<typeof vi.fn>).mockResolvedValue(mockNc);

    const { result } = renderHook(() => useNatsStatus(), {
      wrapper: createWrapper(queryClient),
    });

    // Wait for the async connect to complete
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(result.current.connected).toBe(true);
  });
});

// ── useNatsSubscription ─────────────────────────────────────────────────────

describe('useNatsSubscription', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls handler when a matching event is dispatched', async () => {
    const { connect: mockConnect } = await import('nats.ws');

    let messageCallback: ((msg: { subject: string; data: Uint8Array }) => void) | null = null;

    const mockSub = {
      [Symbol.asyncIterator]: () => {
        return {
          next: () =>
            new Promise<{ value: { subject: string; data: Uint8Array }; done: boolean }>((resolve) => {
              messageCallback = (msg) => resolve({ value: msg, done: false });
            }),
        };
      },
      unsubscribe: vi.fn(),
    };

    const mockNc = {
      subscribe: vi.fn().mockReturnValue(mockSub),
      status: vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise(() => {}),
        }),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    (mockConnect as ReturnType<typeof vi.fn>).mockResolvedValue(mockNc);

    const handler = vi.fn();

    renderHook(() => useNatsSubscription('lt.events.task.>', handler), {
      wrapper: createWrapper(queryClient),
    });

    // Wait for connection
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // Simulate a message arriving
    const event = {
      type: 'task.completed',
      source: 'interceptor',
      workflowId: 'wf-1',
      workflowName: 'test',
      taskQueue: 'q',
      timestamp: new Date().toISOString(),
    };

    if (messageCallback) {
      await act(async () => {
        messageCallback!({
          subject: 'lt.events.task.completed',
          data: new TextEncoder().encode(JSON.stringify(event)),
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'task.completed' }));
  });

  it('does not call handler for non-matching events', async () => {
    const { connect: mockConnect } = await import('nats.ws');

    let messageCallback: ((msg: { subject: string; data: Uint8Array }) => void) | null = null;

    const mockSub = {
      [Symbol.asyncIterator]: () => ({
        next: () =>
          new Promise<{ value: { subject: string; data: Uint8Array }; done: boolean }>((resolve) => {
            messageCallback = (msg) => resolve({ value: msg, done: false });
          }),
      }),
      unsubscribe: vi.fn(),
    };

    const mockNc = {
      subscribe: vi.fn().mockReturnValue(mockSub),
      status: vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise(() => {}),
        }),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    (mockConnect as ReturnType<typeof vi.fn>).mockResolvedValue(mockNc);

    const handler = vi.fn();

    // Only subscribe to escalation events
    renderHook(() => useNatsSubscription('lt.events.escalation.>', handler), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // Send a task event (should not match escalation pattern)
    if (messageCallback) {
      await act(async () => {
        messageCallback!({
          subject: 'lt.events.task.completed',
          data: new TextEncoder().encode(JSON.stringify({
            type: 'task.completed',
            source: 'interceptor',
            workflowId: 'wf-1',
            workflowName: 'test',
            taskQueue: 'q',
            timestamp: new Date().toISOString(),
          })),
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    expect(handler).not.toHaveBeenCalled();
  });
});
