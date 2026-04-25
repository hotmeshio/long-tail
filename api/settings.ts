import { telemetryRegistry } from '../lib/telemetry';
import { eventRegistry } from '../lib/events';
import { NatsEventAdapter } from '../lib/events/nats';
import { SocketIOEventAdapter } from '../lib/events/socketio';
import { CLAIM_DURATION_OPTIONS } from '../modules/defaults';
import type { LTApiResult } from '../types/sdk';

export async function getSettings(): Promise<LTApiResult> {
  try {
    const hasSocketIO = !!eventRegistry.getAdapter(SocketIOEventAdapter);
    const hasNats = !!eventRegistry.getAdapter(NatsEventAdapter);

    const transport = hasSocketIO ? 'socketio' : hasNats ? 'nats' : 'none';

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
          natsWsUrl: hasNats
            ? (process.env.VITE_NATS_WS_URL || process.env.NATS_WS_URL || null)
            : null,
        },
      },
    };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
