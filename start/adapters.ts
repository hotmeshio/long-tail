import { loggerRegistry } from '../services/logger';
import { PinoLoggerAdapter } from '../services/logger/pino';
import { telemetryRegistry } from '../services/telemetry';
import { HoneycombTelemetryAdapter } from '../services/telemetry/honeycomb';
import { eventRegistry } from '../services/events';
import { NatsEventAdapter } from '../services/events/nats';
import { SocketIOEventAdapter } from '../services/events/socketio';
import { maintenanceRegistry } from '../services/maintenance';
import { defaultMaintenanceConfig } from '../modules/maintenance';
import { mcpRegistry } from '../services/mcp';
import { BuiltInMcpAdapter } from '../services/mcp/adapter';
import { escalationStrategyRegistry } from '../services/escalation-strategy';
import { DefaultEscalationStrategy } from '../services/escalation-strategy/default';
import { McpEscalationStrategy } from '../services/escalation-strategy/mcp';

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

  // Events — always register socket.io (zero-cost until HTTP server attaches).
  // NATS is additive: when configured, events publish to both transports.
  if (startConfig.events?.adapters) {
    for (const adapter of startConfig.events.adapters) {
      eventRegistry.register(adapter);
    }
  } else {
    if (startConfig.events?.nats) {
      eventRegistry.register(new NatsEventAdapter(startConfig.events.nats));
    }
    eventRegistry.register(new SocketIOEventAdapter());
  }

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
