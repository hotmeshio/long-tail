import type { LoggerOptions } from 'pino';

import type { LTAuthAdapter } from './auth';
import type { LTOAuthStartConfig } from './oauth';
import type { LTTelemetryAdapter } from './telemetry';
import type { LTEventAdapter } from './events';
import type { LTLoggerAdapter } from './logger';
import type { LTMaintenanceConfig } from './maintenance';
import type { LTMcpAdapter } from './mcp';
import type { LTEscalationStrategy } from './escalation-strategy';

export interface LTStartConfig {
  /** PostgreSQL connection. Provide individual fields or a connectionString. */
  database: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    connectionString?: string;
  };

  /** Embedded API server. Default: enabled on port 3000. */
  server?: {
    enabled?: boolean;
    port?: number;
  };

  /** Workflow workers to start. Each entry registers a worker on the given queue. */
  workers?: Array<{
    taskQueue: string;
    workflow: (...args: any[]) => any;
  }>;

  /** Interceptor defaults applied when a workflow escalates. */
  interceptor?: {
    defaultRole?: string;
  };

  /** Authentication. Defaults to the built-in JWT adapter using JWT_SECRET. */
  auth?: {
    /** JWT secret for the built-in adapter. */
    secret?: string;
    /** Replace the built-in JWT adapter entirely. */
    adapter?: LTAuthAdapter;
    /** OAuth/OIDC configuration for identity and resource OAuth. */
    oauth?: LTOAuthStartConfig;
  };

  /** OpenTelemetry. Register before workers start. */
  telemetry?: {
    honeycomb?: { apiKey: string; serviceName?: string; endpoint?: string; traceUrl?: string };
    adapter?: LTTelemetryAdapter;
  };

  /** Milestone event publishing. */
  events?: {
    nats?: { url?: string; subjectPrefix?: string; token?: string };
    adapters?: LTEventAdapter[];
  };

  /** Structured logging. Defaults to console.* when omitted. */
  logging?: {
    pino?: LoggerOptions;
    adapter?: LTLoggerAdapter;
  };

  /**
   * Database maintenance schedule.
   * - `true` or `undefined` → default nightly 2 AM cleanup
   * - `false` → disabled
   * - `LTMaintenanceConfig` → custom schedule and rules
   */
  maintenance?: LTMaintenanceConfig | boolean;

  /**
   * Escalation strategy. Controls what happens when a resolver submits.
   * - `'default'` or omitted → standard re-run (today's behavior)
   * - `'mcp'` → enables MCP triage orchestrator for `needsTriage` resolutions
   * - `adapter` → replace with a custom `LTEscalationStrategy`
   */
  escalation?: {
    strategy?: 'default' | 'mcp';
    adapter?: LTEscalationStrategy;
  };

  /**
   * Load example workflows and seed sample data on startup.
   * When `true`, appends the built-in example workers and starts
   * a few sample workflows so the dashboard has data immediately.
   */
  examples?: boolean;

  /** MCP (Model Context Protocol) integration. */
  mcp?: {
    /** Built-in MCP server (human queue) configuration. */
    server?: {
      /** Enable the built-in human-queue MCP server. Default: true. */
      enabled?: boolean;
      /** Server name reported to MCP clients. Default: 'long-tail-human-queue'. */
      name?: string;
    };
    /** MCP server IDs to auto-connect on startup. */
    autoConnect?: string[];
    /** Replace the built-in MCP adapter entirely. */
    adapter?: LTMcpAdapter;
  };
}

export interface LTInstance {
  /** Durable client for starting workflows and querying state. */
  client: any;
  /** Graceful shutdown — stops workers, server, and adapters. */
  shutdown: () => Promise<void>;
}
