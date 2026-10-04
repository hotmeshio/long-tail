import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('nats.ws', () => ({
  connect: vi.fn(),
  StringCodec: () => ({ decode: (d: Uint8Array) => new TextDecoder().decode(d), encode: (s: string) => new TextEncoder().encode(s) }),
}));

import { connect } from 'nats.ws';
import { NatsProvider, useNatsStatus, useNatsSubscription } from '../useNats';
import type { NatsCredentials } from '../../lib/nats/credentials';

const connectMock = vi.mocked(connect) as unknown as ReturnType<typeof vi.fn>;
const POLICY = { initialDelayMs: 1, maxDelayMs: 4, noticeAfterMs: 30 };
const hang = () => new Promise<never>(() => {});

/** A fake connection whose `closed()` settles when `drop()` is called. */
function fakeConnection() {
  let drop!: () => void;
  const closed = new Promise<void>((resolve) => { drop = resolve; });
  const nc = {
    subscribe: vi.fn(() => ({ [Symbol.asyncIterator]: () => ({ next: hang }), unsubscribe: vi.fn() })),
    status: vi.fn(() => ({ [Symbol.asyncIterator]: () => ({ next: hang }) })),
    close: vi.fn().mockResolvedValue(undefined),
    closed: () => closed,
  };
  return { nc, drop: () => act(async () => { drop(); }) };
}

const ok = (url: string): NatsCredentials => ({ kind: 'ok', url, token: null });

function wrapperFor(props: { resolveCredentials: () => Promise<NatsCredentials>; onReconnect?: () => void }) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <NatsProvider policy={POLICY} {...props}>{children}</NatsProvider>;
  };
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

describe('NatsProvider reconnect loop', () => {
  beforeEach(() => {
    connectMock.mockReset();
    setVisibility('visible');
  });

  afterEach(() => {
    setVisibility('visible');
  });

  it('reconnects after a drop with credentials fetched for that attempt', async () => {
    const first = fakeConnection();
    const second = fakeConnection();
    connectMock.mockResolvedValueOnce(first.nc).mockResolvedValueOnce(second.nc);
    const resolveCredentials = vi.fn()
      .mockResolvedValueOnce(ok('wss://h/nats-ws?ticket=1'))
      .mockResolvedValueOnce(ok('wss://h/nats-ws?ticket=2'));

    const { result } = renderHook(() => useNatsStatus(), { wrapper: wrapperFor({ resolveCredentials }) });
    await waitFor(() => expect(result.current.connected).toBe(true));

    await first.drop();
    await waitFor(() => expect(connectMock).toHaveBeenCalledTimes(2));
    expect(connectMock.mock.calls[1][0]).toMatchObject({ servers: 'wss://h/nats-ws?ticket=2', reconnect: false });
    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it('refetches after a replacement connection, not after the first', async () => {
    const first = fakeConnection();
    connectMock.mockResolvedValueOnce(first.nc).mockResolvedValueOnce(fakeConnection().nc);
    const onReconnect = vi.fn();
    const resolveCredentials = vi.fn().mockResolvedValue(ok('wss://h'));

    const { result } = renderHook(() => useNatsStatus(), { wrapper: wrapperFor({ resolveCredentials, onReconnect }) });
    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(onReconnect).not.toHaveBeenCalled();

    await first.drop();
    await waitFor(() => expect(onReconnect).toHaveBeenCalledTimes(1));
  });

  it('reopens every subscribed pattern on the new connection', async () => {
    const first = fakeConnection();
    const second = fakeConnection();
    connectMock.mockResolvedValueOnce(first.nc).mockResolvedValueOnce(second.nc);
    const resolveCredentials = vi.fn().mockResolvedValue(ok('wss://h'));

    renderHook(() => useNatsSubscription('lt.events.task.>', () => {}), { wrapper: wrapperFor({ resolveCredentials }) });
    await waitFor(() => expect(first.nc.subscribe).toHaveBeenCalledWith('lt.events.task.>'));

    await first.drop();
    await waitFor(() => expect(second.nc.subscribe).toHaveBeenCalledWith('lt.events.task.>'));
  });

  it('retries with backoff until credentials are available', async () => {
    connectMock.mockResolvedValue(fakeConnection().nc);
    const resolveCredentials = vi.fn()
      .mockResolvedValueOnce({ kind: 'unavailable' })
      .mockResolvedValueOnce({ kind: 'unavailable' })
      .mockResolvedValue(ok('wss://h'));

    const { result } = renderHook(() => useNatsStatus(), { wrapper: wrapperFor({ resolveCredentials }) });
    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(resolveCredentials).toHaveBeenCalledTimes(3);
  });

  it('stops when the session has ended and shows no notice', async () => {
    const resolveCredentials = vi.fn().mockResolvedValue({ kind: 'session-ended' });

    const { result } = renderHook(() => useNatsStatus(), { wrapper: wrapperFor({ resolveCredentials }) });
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(resolveCredentials).toHaveBeenCalledTimes(1);
    expect(connectMock).not.toHaveBeenCalled();
    expect(result.current.unavailable).toBe(false);
  });

  it('runs one attempt at a time', async () => {
    const resolveCredentials = vi.fn(hang);
    renderHook(() => useNatsStatus(), { wrapper: wrapperFor({ resolveCredentials }) });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(resolveCredentials).toHaveBeenCalledTimes(1);
  });

  it('waits while the tab is hidden and resumes when it is shown', async () => {
    setVisibility('hidden');
    connectMock.mockResolvedValue(fakeConnection().nc);
    const resolveCredentials = vi.fn().mockResolvedValue(ok('wss://h'));

    const { result } = renderHook(() => useNatsStatus(), { wrapper: wrapperFor({ resolveCredentials }) });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(resolveCredentials).not.toHaveBeenCalled();

    setVisibility('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it('reports unavailable once down past the threshold, and clears on connect', async () => {
    let succeed = false;
    connectMock.mockImplementation(async () => {
      if (!succeed) throw new Error('refused');
      return fakeConnection().nc;
    });
    const resolveCredentials = vi.fn().mockResolvedValue(ok('wss://h'));

    const { result } = renderHook(() => useNatsStatus(), { wrapper: wrapperFor({ resolveCredentials }) });
    await waitFor(() => expect(result.current.unavailable).toBe(true));

    succeed = true;
    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.unavailable).toBe(false);
  });
});
