import { telemetryRegistry } from '../lib/telemetry';
import { eventRegistry } from '../lib/events';
import { NatsEventAdapter } from '../lib/events/nats';
import { SocketIOEventAdapter } from '../lib/events/socketio';
import { config } from '../modules/config';
import { CLAIM_DURATION_OPTIONS } from '../modules/defaults';
import { hasLLMApiKey } from '../services/llm';
import type { LTApiResult } from '../types/sdk';

/**
 * Return platform settings for the current deployment.
 *
 * Includes telemetry configuration (trace URL), escalation claim duration
 * options, and event transport details (socket.io, NATS, or none).
 *
 * @returns `{ status: 200, data: { telemetry, escalation, events } }`
 */
export async function getSettings(): Promise<LTApiResult> {
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
          natsWsUrl: natsAdapter?.wsUrl ?? null,
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
