import { loggerRegistry } from '../lib/logger';
import { PinoLoggerAdapter } from '../lib/logger/pino';
import { telemetryRegistry } from '../lib/telemetry';
import { HoneycombTelemetryAdapter } from '../lib/telemetry/honeycomb';
import { eventRegistry } from '../lib/events';
import { NatsEventAdapter } from '../lib/events/nats';
import { SocketIOEventAdapter } from '../lib/events/socketio';
import { CallbackEventAdapter } from '../lib/events/callback';
import { maintenanceRegistry } from '../services/maintenance';
import { defaultMaintenanceConfig } from '../modules/maintenance';
import { mcpRegistry } from '../services/mcp';
import { BuiltInMcpAdapter } from '../services/mcp/adapter';
import { escalationStrategyRegistry } from '../services/escalation-strategy';
import { DefaultEscalationStrategy } from '../services/escalation-strategy/default';
import { McpEscalationStrategy } from '../services/escalation-strategy/mcp';

import { createSocketIOAuthenticator } from './socket-auth';
import type { LTStartConfig } from '../types/startup';

/**
 * Register all adapters (logging, telemetry, events, maintenance,
 * escalation strategy, MCP) based on the startup config.
 */
export function registerAdapters(startConfig: LTStartConfig): void {
  // Logging (register first so subsequent log calls use it)
  if (startConfig.logging?.adapter) {
    loggerRegistry.register(startConfig.logging.adapter);
  } else if (startConfig.logging?.pino) {
    loggerRegistry.register(new PinoLoggerAdapter(startConfig.logging.pino));
  }

  // Telemetry
  if (startConfig.telemetry?.adapter) {
    telemetryRegistry.register(startConfig.telemetry.adapter);
  } else if (startConfig.telemetry?.honeycomb) {
    telemetryRegistry.register(new HoneycombTelemetryAdapter(startConfig.telemetry.honeycomb));
  }

  // Events — register the configured transport.
  // Socket.IO is the default for single-container ("nothing but Postgres").
  // When NATS or custom adapters are configured, Socket.IO is NOT registered —
  // the dashboard auto-detects the transport via GET /api/settings and connects
  // directly (e.g., NATS WebSocket). Socket.IO never interferes in production.
  if (startConfig.events?.adapters) {
    for (const adapter of startConfig.events.adapters) {
      eventRegistry.register(adapter);
    }
  } else if (startConfig.events?.nats) {
    eventRegistry.register(new NatsEventAdapter(startConfig.events.nats));
  } else {
    eventRegistry.register(new SocketIOEventAdapter({
      authenticate: createSocketIOAuthenticator(startConfig),
    }));
  }

  // CallbackEventAdapter is registered later in start/workers.ts
  // so it can be wired to the NATS bridge before connect().
  // Do NOT register a duplicate here.

  // Maintenance
  if (startConfig.maintenance === false) {
    // Disabled
  } else if (startConfig.maintenance === true || startConfig.maintenance === undefined) {
    maintenanceRegistry.register(defaultMaintenanceConfig);
  } else {
    maintenanceRegistry.register(startConfig.maintenance);
  }

  // Escalation strategy
  if (startConfig.escalation?.adapter) {
    escalationStrategyRegistry.register(startConfig.escalation.adapter);
  } else if (startConfig.escalation?.strategy === 'mcp') {
    escalationStrategyRegistry.register(new McpEscalationStrategy());
  } else {
    escalationStrategyRegistry.register(new DefaultEscalationStrategy());
  }

  // MCP
  if (startConfig.mcp?.adapter) {
    mcpRegistry.register(startConfig.mcp.adapter);
  } else if (startConfig.mcp) {
    mcpRegistry.register(new BuiltInMcpAdapter({
      server: startConfig.mcp.server,
      autoConnect: startConfig.mcp.autoConnect,
    }));
  }
}
