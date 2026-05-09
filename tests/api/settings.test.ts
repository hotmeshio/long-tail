import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { eventRegistry } from '../../lib/events';
import { NatsEventAdapter } from '../../lib/events/nats';
import { SocketIOEventAdapter } from '../../lib/events/socketio';

vi.mock('../../lib/telemetry', () => ({
  telemetryRegistry: { traceUrl: null },
}));

// ── Imports (after mocks) ────────────────────────────────────────────
import { getSettings } from '../../api/settings';

// ── Tests ────────────────────────────────────────────────────────────

beforeEach(() => {
  eventRegistry.clear();
});

afterEach(() => {
  eventRegistry.clear();
  delete process.env.NATS_TOKEN;
  delete process.env.NATS_WS_URL;
  delete process.env.VITE_NATS_WS_URL;
  delete process.env.EVENT_TRANSPORT;
});

describe('getSettings — transport detection', () => {
  it('returns "socketio" by default even when NATS is also registered', async () => {
    eventRegistry.register(new SocketIOEventAdapter());
    eventRegistry.register(new NatsEventAdapter({ url: 'nats://localhost:4222' }));

    const result = await getSettings();
    expect(result.status).toBe(200);
    expect(result.data.events.transport).toBe('socketio');
  });

  it('returns "nats" when EVENT_TRANSPORT=nats and NATS adapter is registered', async () => {
    process.env.EVENT_TRANSPORT = 'nats';
    eventRegistry.register(new SocketIOEventAdapter());
    eventRegistry.register(new NatsEventAdapter({ url: 'nats://localhost:4222' }));

    const result = await getSettings();
    expect(result.status).toBe(200);
    expect(result.data.events.transport).toBe('nats');
  });

  it('returns "socketio" when EVENT_TRANSPORT=nats but no NATS adapter registered', async () => {
    process.env.EVENT_TRANSPORT = 'nats';
    eventRegistry.register(new SocketIOEventAdapter());

    const result = await getSettings();
    expect(result.status).toBe(200);
    expect(result.data.events.transport).toBe('socketio');
  });

  it('returns "nats" when only NATS is registered (no socket.io)', async () => {
    eventRegistry.register(new NatsEventAdapter({ url: 'nats://localhost:4222' }));

    const result = await getSettings();
    expect(result.status).toBe(200);
    expect(result.data.events.transport).toBe('nats');
  });

  it('returns "socketio" when only socket.io is registered', async () => {
    eventRegistry.register(new SocketIOEventAdapter());

    const result = await getSettings();
    expect(result.status).toBe(200);
    expect(result.data.events.transport).toBe('socketio');
  });

  it('returns "none" when no event adapters are registered', async () => {
    const result = await getSettings();
    expect(result.status).toBe(200);
    expect(result.data.events.transport).toBe('none');
  });
});

describe('getSettings — NATS token and URL', () => {
  it('includes natsToken from env when NATS is registered', async () => {
    process.env.NATS_TOKEN = 'my-secret-token';
    eventRegistry.register(new NatsEventAdapter({ url: 'nats://localhost:4222' }));

    const result = await getSettings();
    expect(result.data.events.natsToken).toBe('my-secret-token');
  });

  it('returns null natsToken when NATS is not registered', async () => {
    process.env.NATS_TOKEN = 'my-secret-token';
    eventRegistry.register(new SocketIOEventAdapter());

    const result = await getSettings();
    expect(result.data.events.natsToken).toBeNull();
  });

  it('returns null natsToken when env var is not set', async () => {
    delete process.env.NATS_TOKEN;
    eventRegistry.register(new NatsEventAdapter({ url: 'nats://localhost:4222' }));

    const result = await getSettings();
    expect(result.data.events.natsToken).toBeNull();
  });

  it('includes natsWsUrl from NATS_WS_URL env when NATS is registered', async () => {
    process.env.NATS_WS_URL = 'ws://nats.example.com:9222';
    eventRegistry.register(new NatsEventAdapter({ url: 'nats://localhost:4222' }));

    const result = await getSettings();
    expect(result.data.events.natsWsUrl).toBe('ws://nats.example.com:9222');
  });

  it('prefers VITE_NATS_WS_URL over NATS_WS_URL', async () => {
    process.env.VITE_NATS_WS_URL = 'ws://vite.example.com:9222';
    process.env.NATS_WS_URL = 'ws://fallback.example.com:9222';
    eventRegistry.register(new NatsEventAdapter({ url: 'nats://localhost:4222' }));

    const result = await getSettings();
    expect(result.data.events.natsWsUrl).toBe('ws://vite.example.com:9222');
  });

  it('returns null natsWsUrl when NATS is not registered', async () => {
    process.env.NATS_WS_URL = 'ws://nats.example.com:9222';
    eventRegistry.register(new SocketIOEventAdapter());

    const result = await getSettings();
    expect(result.data.events.natsWsUrl).toBeNull();
  });
});
