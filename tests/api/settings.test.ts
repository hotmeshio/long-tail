import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { eventRegistry } from '../../lib/events';
import { NatsEventAdapter } from '../../lib/events/nats';
import { SocketIOEventAdapter } from '../../lib/events/socketio';
import { config } from '../../modules/config';

vi.mock('../../lib/telemetry', () => ({
  telemetryRegistry: { traceUrl: null },
}));

// ── Imports (after mocks) ────────────────────────────────────────────
import { getSettings } from '../../api/settings';
import { hasLLMApiKey } from '../../services/llm';

// ── Tests ────────────────────────────────────────────────────────────

const originalEventTransport = config.EVENT_TRANSPORT;

beforeEach(() => {
  eventRegistry.clear();
});

afterEach(() => {
  eventRegistry.clear();
  config.EVENT_TRANSPORT = originalEventTransport;
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
    config.EVENT_TRANSPORT = 'nats';
    eventRegistry.register(new SocketIOEventAdapter());
    eventRegistry.register(new NatsEventAdapter({ url: 'nats://localhost:4222' }));

    const result = await getSettings();
    expect(result.status).toBe(200);
    expect(result.data.events.transport).toBe('nats');
  });

  it('returns "socketio" when EVENT_TRANSPORT=nats but no NATS adapter registered', async () => {
    config.EVENT_TRANSPORT = 'nats';
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

describe('getSettings — NATS credentials excluded', () => {
  it('does not include natsToken even when NATS is registered', async () => {
    eventRegistry.register(new NatsEventAdapter({ url: 'nats://localhost:4222', token: 'my-secret-token' }));

    const result = await getSettings();
    expect(result.data.events).not.toHaveProperty('natsToken');
  });

  it('does not include natsToken when NATS is not registered', async () => {
    eventRegistry.register(new SocketIOEventAdapter());

    const result = await getSettings();
    expect(result.data.events).not.toHaveProperty('natsToken');
  });

  it('includes natsWsUrl from adapter when NATS is registered', async () => {
    eventRegistry.register(new NatsEventAdapter({ url: 'nats://localhost:4222', wsUrl: 'ws://nats.example.com:9222' }));

    const result = await getSettings();
    expect(result.data.events.natsWsUrl).toBe('ws://nats.example.com:9222');
  });

  it('returns null natsWsUrl when NATS is not registered', async () => {
    eventRegistry.register(new SocketIOEventAdapter());

    const result = await getSettings();
    expect(result.data.events.natsWsUrl).toBeNull();
  });

  it('derives natsWsUrl from request headers when wsProxy is set but wsUrl is null', async () => {
    eventRegistry.register(new NatsEventAdapter({ url: 'nats://localhost:4222', wsProxy: 'ws://nats:9222' }));

    const mockReq = {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'api.example.com',
        host: 'localhost:3000',
      },
    };

    const result = await getSettings(mockReq as any);
    expect(result.data.events.natsWsUrl).toBe('wss://api.example.com/nats-ws');
  });

  it('caches derived wsUrl on the adapter for subsequent requests', async () => {
    const adapter = new NatsEventAdapter({ url: 'nats://localhost:4222', wsProxy: 'ws://nats:9222' });
    eventRegistry.register(adapter);

    const mockReq = {
      headers: { host: 'localhost:3000' },
    };

    await getSettings(mockReq as any);
    expect(adapter.wsUrl).toBe('ws://localhost:3000/nats-ws');

    // Second call without req still returns the cached value
    const result = await getSettings();
    expect(result.data.events.natsWsUrl).toBe('ws://localhost:3000/nats-ws');
  });

  it('includes basePath in derived wsUrl when proxy has a basePath', async () => {
    const adapter = new NatsEventAdapter({ url: 'nats://localhost:4222', wsProxy: 'ws://nats:9222' });
    adapter.setWsProxyBasePath('/longtail');
    eventRegistry.register(adapter);

    const mockReq = {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'api.example.com',
      },
    };

    const result = await getSettings(mockReq as any);
    expect(result.data.events.natsWsUrl).toBe('wss://api.example.com/longtail/nats-ws');
  });
});

describe('getSettings — AI availability', () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalLtKey = process.env.LT_LLM_API_KEY;
  const originalOpenAIKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    // Restore original env
    if (originalAnthropicKey !== undefined) process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    else delete process.env.ANTHROPIC_API_KEY;
    if (originalLtKey !== undefined) process.env.LT_LLM_API_KEY = originalLtKey;
    else delete process.env.LT_LLM_API_KEY;
    if (originalOpenAIKey !== undefined) process.env.OPENAI_API_KEY = originalOpenAIKey;
    else delete process.env.OPENAI_API_KEY;
  });

  it('returns ai.enabled: true when an LLM API key is configured', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    const result = await getSettings();
    expect(result.status).toBe(200);
    expect(result.data.ai).toEqual({ enabled: true });
  });

  it('returns ai.enabled: false when no LLM API key is configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LT_LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const result = await getSettings();
    expect(result.status).toBe(200);
    expect(result.data.ai).toEqual({ enabled: false });
  });

  it('returns ai.enabled: false when key is the placeholder "xxx"', async () => {
    delete process.env.LT_LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'xxx';
    const result = await getSettings();
    expect(result.status).toBe(200);
    expect(result.data.ai.enabled).toBe(false);
  });

  it('hasLLMApiKey returns true for real key', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-real-key';
    expect(hasLLMApiKey()).toBe(true);
  });

  it('hasLLMApiKey returns false for missing key', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LT_LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(hasLLMApiKey()).toBe(false);
  });
});
