import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

// The socket follows the session: no connection while logged out, a
// connection once a login lands, the current token at every attempt, and a
// disconnect on logout.
const state = vi.hoisted(() => ({ authenticated: false, token: null as string | null }));

const sockets: any[] = [];
vi.mock('socket.io-client', () => ({
  io: vi.fn((opts: any) => {
    const handlers = new Map<string, (...a: any[]) => void>();
    const socket = {
      opts,
      id: `s${sockets.length + 1}`,
      on: (name: string, fn: (...a: any[]) => void) => { handlers.set(name, fn); return socket; },
      onAny: vi.fn(),
      emit: vi.fn(),
      removeAllListeners: vi.fn(),
      disconnect: vi.fn(),
      fire: (name: string, ...a: any[]) => handlers.get(name)?.(...a),
    };
    sockets.push(socket);
    return socket;
  }),
}));
vi.mock('../useAuth', () => ({ useAuth: () => ({ isAuthenticated: state.authenticated }) }));
vi.mock('../../api/client', () => ({ getToken: () => state.token }));

import { SocketIOProvider } from '../useSocketIO';

beforeEach(() => { sockets.length = 0; state.authenticated = false; state.token = null; });

describe('SocketIOProvider — session-bound connection', () => {
  it('opens no socket while logged out', () => {
    render(<SocketIOProvider><span /></SocketIOProvider>);
    expect(sockets).toHaveLength(0);
  });

  it('connects once the login lands and hands the current token to each attempt', () => {
    const { rerender } = render(<SocketIOProvider><span /></SocketIOProvider>);
    act(() => { state.authenticated = true; state.token = 'jwt-1'; });
    rerender(<SocketIOProvider><span /></SocketIOProvider>);
    expect(sockets).toHaveLength(1);

    const cb = vi.fn();
    sockets[0].opts.auth(cb);
    expect(cb).toHaveBeenCalledWith({ token: 'jwt-1' });

    state.token = 'jwt-2';
    sockets[0].opts.auth(cb);
    expect(cb).toHaveBeenLastCalledWith({ token: 'jwt-2' });
  });

  it('disconnects on logout', () => {
    state.authenticated = true; state.token = 'jwt-1';
    const { rerender } = render(<SocketIOProvider><span /></SocketIOProvider>);
    expect(sockets).toHaveLength(1);
    act(() => { state.authenticated = false; });
    rerender(<SocketIOProvider><span /></SocketIOProvider>);
    expect(sockets[0].disconnect).toHaveBeenCalled();
    expect(sockets).toHaveLength(1);
  });
});
