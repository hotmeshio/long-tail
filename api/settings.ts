import type { IncomingMessage } from 'http';

import { telemetryRegistry } from '../lib/telemetry';
import { eventRegistry } from '../lib/events';
import { NatsEventAdapter } from '../lib/events/nats';
import { SocketIOEventAdapter } from '../lib/events/socketio';
import { deriveWsUrlFromRequest } from '../lib/events/nats-ws-proxy';
import { config } from '../modules/config';
import { CLAIM_DURATION_OPTIONS } from '../modules/defaults';
import { hasLLMApiKey } from '../services/llm';
import type { LTApiResult } from '../types/sdk';

/**
 * Resolve the NATS WebSocket URL for the browser.
 *
 * Priority:
 * 1. Explicit wsUrl on the adapter (set via config or auto-derived from a prior request)
 * 2. When a wsProxy is configured, derive from the current request's headers
 * 3. null — no NATS WS available
 */
function resolveNatsWsUrl(
  adapter: NatsEventAdapter,
  req?: IncomingMessage,
): string | null {
  if (adapter.wsUrl) return adapter.wsUrl;
  if (adapter.wsProxyTarget && req) {
    const derived = deriveWsUrlFromRequest(req);
    // Cache for future requests and for the proxy's onWsUrlDerived
    adapter.setWsUrl(derived);
    return derived;
  }
  return null;
}

/**
 * Return platform settings for the current deployment.
 *
 * Includes telemetry configuration (trace URL), escalation claim duration
 * options, and event transport details (socket.io, NATS, or none).
 *
 * @param req — the incoming HTTP request, used to derive NATS WS URL from headers when proxying
 * @returns `{ status: 200, data: { telemetry, escalation, events } }`
 */
export async function getSettings(req?: IncomingMessage): Promise<LTApiResult> {
  try {
    const hasSocketIO = !!eventRegistry.getAdapter(SocketIOEventAdapter);
    const natsAdapter = eventRegistry.getAdapter(NatsEventAdapter);

    // Dashboard transport: Socket.IO is the default (works in-process, zero config).
    // NATS is only reported when explicitly opted in via EVENT_TRANSPORT=nats,
    // which a multi-container deployment sets when it wants the dashboard to
    // connect via NATS instead of Socket.IO.
    const forceNats = config.EVENT_TRANSPORT === 'nats';
    const transport = forceNats && natsAdapter ? 'nats' : hasSocketIO ? 'socketio' : natsAdapter ? 'nats' : 'none';

    return {
      status: 200,
      data: {
        telemetry: {
          traceUrl: telemetryRegistry.traceUrl ?? null,
        },
        escalation: {
          claimDurations: CLAIM_DURATION_OPTIONS,
        },
        events: {
          transport,
          natsWsUrl: natsAdapter ? resolveNatsWsUrl(natsAdapter, req) : null,
        },
        ai: {
          enabled: hasLLMApiKey(),
        },
      },
    };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
