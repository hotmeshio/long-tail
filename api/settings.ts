import type { IncomingMessage } from 'http';

import { telemetryRegistry } from '../lib/telemetry';
import { eventRegistry } from '../lib/events';
import { NatsEventAdapter } from '../lib/events/nats';
import { SocketIOEventAdapter } from '../lib/events/socketio';
import { deriveWsUrlFromRequest } from '../lib/events/nats-ws-proxy';
import { config } from '../modules/config';
import { getFeatureFlags } from '../modules/features';
import { getSearchConfig } from '../modules/search';
import { getBranding } from '../modules/branding';
import { getOAuthServerSettings } from '../modules/oauth-server';
import { getDisplay } from '../modules/display';
import { getMachineSurface } from '../modules/machines';
import { LONG_TAIL_VERSION, HOTMESH_VERSION } from '../modules/version';
import { isSSOEnabled, getSSOConfig } from '../modules/sso';
import { CLAIM_DURATION_OPTIONS } from '../modules/defaults';
import { hasLLMApiKey } from '../services/llm';
import type { LTApiResult } from '../types/sdk';
import { durableProviderRegistry } from '../services/durable-provider';

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
    const derived = deriveWsUrlFromRequest(req, adapter.wsProxyBasePath);
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
 * options, event transport details (socket.io, NATS, or none), and an
 * environment block (long-tail + HotMesh versions, Node env/version).
 *
 * @param req — the incoming HTTP request, used to derive NATS WS URL from headers when proxying
 * `machines` is present only when `start({ machines })` runs a surface; it carries the
 * number of lines this replica runs and nothing else, since the settings are public.
 *
 * @returns `{ status: 200, data: { telemetry, escalation, events, auth, ai, features, search, branding, display, environment, machines? } }`
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
    const machines = getMachineSurface();

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
          reconnect: {
            initialDelayMs: config.NATS_RECONNECT_INITIAL_MS,
            maxDelayMs: config.NATS_RECONNECT_MAX_MS,
            noticeAfterMs: config.NATS_LIVE_NOTICE_AFTER_MS,
            spreadMs: config.NATS_RECONNECT_SPREAD_MS,
          },
        },
        auth: {
          sso: isSSOEnabled(),
          ssoLogoutUrl: getSSOConfig()?.logoutUrl ?? null,
          // Session keepalive dials for the SPA (null = no keepalive / no idle gate).
          ssoKeepaliveSeconds: getSSOConfig()?.keepaliveSeconds ?? null,
          ssoKeepaliveIdleTimeoutSeconds: getSSOConfig()?.keepaliveIdleTimeoutSeconds ?? null,
          // The OAuth authorization server for MCP clients (Connected apps).
          oauthServer: getOAuthServerSettings() !== null,
        },
        ai: {
          // AI surfaces (triage, query, compile) run as HotMesh workflows.
          enabled: hasLLMApiKey() && durableProviderRegistry.isNative,
        },
        engine: engineSettings(),
        features: getFeatureFlags(),
        search: getSearchConfig(),
        branding: getBranding(),
        display: getDisplay(),
        environment: {
          longTailVersion: LONG_TAIL_VERSION,
          hotmeshVersion: HOTMESH_VERSION,
          nodeEnv: config.NODE_ENV,
          nodeVersion: process.version,
          eventTransport: transport,
        },
        ...(machines ? { machines: { declared: machines.describeLines().length } } : {}),
      },
    };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/** The durable engine running workflows, and what the dashboard can show for it. */
function engineSettings() {
  const provider = durableProviderRegistry.hasProvider ? durableProviderRegistry.current : null;
  return {
    provider: durableProviderRegistry.name,
    native: durableProviderRegistry.isNative,
    capabilities: {
      execution: provider ? provider.capabilities.execution : true,
      terminate: provider ? provider.capabilities.terminate : true,
      list: provider ? provider.capabilities.list : true,
    },
    consoleUrl: durableProviderRegistry.settings.consoleUrl ?? null,
  };
}
