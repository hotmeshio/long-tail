import type { LoggerOptions } from 'pino';

import type { LTAuthAdapter, LTSSOConfig } from './auth';
import type { LTOAuthStartConfig } from './oauth';
import type { LTTelemetryAdapter } from './telemetry';
import type { LTEventAdapter } from './events';
import type { LTLoggerAdapter } from './logger';
import type { LTMaintenanceConfig } from './maintenance';
import type { LTMcpAdapter } from './mcp';
import type { LTEscalationStrategy } from './escalation-strategy';

/**
 * Inline workflow profile declared alongside a worker registration.
 * When present, the config is upserted into `lt_config_workflows` at startup
 * so the dashboard shows forms, roles, and tier badges on first boot.
 *
 * `workflow_type` and `task_queue` are derived automatically from the worker entry.
 * Roles referenced here are auto-created if they don't already exist.
 */
export interface LTWorkerConfig {
  description?: string;
  /** Allow invocation from the dashboard / API. Default: false. */
  invocable?: boolean;
  /** Roles allowed to invoke this workflow. */
  invocationRoles?: string[];
  /** Default role for escalations. Default: 'reviewer'. */
  defaultRole?: string;
  /** Roles that can claim and resolve escalations (certifies the workflow for HITL). */
  roles?: string[];
  /** JSON template that pre-fills the dashboard invocation form. */
  envelopeSchema?: Record<string, any>;
  /** JSON template that pre-fills the escalation resolution form. */
  resolverSchema?: Record<string, any>;
  /** Upstream workflow types whose output is injected into this workflow's envelope. */
  consumes?: string[];
  /** MCP tool tags for discovery routing. */
  toolTags?: string[];
  /** Cron expression for scheduled execution. */
  cronSchedule?: string;
  /** Bot identity to run as (proxy invocation). */
  executeAs?: string;
}

/**
 * Inline MCP server profile declared alongside a server factory.
 * When present, the config is upserted into `lt_mcp_servers` at startup
 * so the dashboard shows tools, tags, and compile hints on first boot.
 */
export interface LTMcpServerConfig {
  description?: string;
  tags?: string[];
  /** Capability category for the Capabilities view (e.g., 'Communication', 'Analysis', 'Data'). */
  category?: string;
  /** Hints for the MCP orchestrator when compiling deterministic pipelines. */
  compileHints?: string;
  /** OAuth providers required by this server's tools (e.g., ['google']). */
  credentialProviders?: string[];
  /** When true, all tools on this server require an AI API key. Server is hidden when no key is configured. */
  aiRequired?: boolean;
  /** Tool manifest — static JSON schema definitions for each tool. */
  toolManifest?: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, any>;
    /** Tool only reads data — safe to expose to external MCP consumers without write permission. */
    read_safe?: boolean;
  }>;
}

/**
 * Declarative agent configuration for startup seeding.
 * Schedules and subscriptions are peers — both are "when X, run Y as Z".
 */
export interface LTAgentConfig {
  name: string;
  description?: string;
  goals?: string;
  rules?: string;
  /** Default: 'active' */
  status?: string;
  knowledge_domain?: string;

  /** Cron-triggered reactions */
  schedules?: Array<{
    cron: string;
    reaction_type?: 'durable' | 'pipeline';
    workflow_type?: string;
    pipeline_id?: string;
    envelope?: Record<string, any>;
    execute_as?: string;
  }>;

  /** Event-triggered reactions */
  subscriptions?: Array<{
    topic: string;
    reaction_type: 'durable' | 'pipeline' | 'mcp_query';
    workflow_type?: string;
    pipeline_id?: string;
    mcp_prompt?: string;
    input_mapping?: Record<string, any>;
    filter?: Record<string, any>;
    execute_as?: string;
  }>;
}

/**
 * Declarative topic catalog entry for startup seeding.
 * Apps declare what they publish so agents can discover and subscribe.
 */
export interface LTTopicConfig {
  topic: string;
  description?: string;
  /** Defaults to first segment of topic, or 'app' for app.* topics. */
  category?: string;
  /** JSON Schema describing the event.data shape. */
  payload_schema?: Record<string, any>;
  /** Concrete example of event.data. */
  example_payload?: Record<string, any>;
  tags?: string[];
  /**
   * When `true`, overwrite the DB entry from config on every boot.
   * Config becomes source of truth — description, schema, tags are
   * reset to match what's declared in code. Without this flag, the
   * DB owns the record after first insert (insert-if-absent).
   *
   * Use this when the topic definition lives in git and should be
   * managed through the CI/CD lifecycle.
   */
  reset?: boolean;
}

/**
 * Declarative graph (YAML/DAG) workflow registered at startup — the graph-form
 * peer of a `workers` entry (which registers a procedural workflow). Hand-author
 * the HotMesh YAML; no MCP server or LLM Designer is required. Each flow is
 * created insert-if-absent, then deployed and activated, and appears under
 * Orchestrate › Graph in the dashboard.
 */
export interface LTGraphWorkflowConfig {
  /** Tool name (snake_case). Unique within the namespace. */
  name: string;
  description?: string;
  /** Raw HotMesh YAML — an `app:` block with one or more `graphs:`. */
  yaml: string;
  /** Namespace / app_id (lowercase alphanumeric). Default: 'graph'. */
  namespace?: string;
  /** JSON Schema for the graph's input — pre-fills the dashboard run form. */
  inputSchema?: Record<string, any>;
  /** JSON Schema for the graph's output — shown on the detail page. */
  outputSchema?: Record<string, any>;
  /** Classification tags for discovery. */
  tags?: string[];
}

export interface LTStartConfig {
  /** PostgreSQL connection. Provide individual fields or a connectionString. */
  database: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    connectionString?: string;
    /**
     * SSL/TLS configuration for the PostgreSQL connection.
     * Pass `true` to enable with defaults, `false` to disable, or an object
     * matching Node `tls.connect()` options (e.g. `{ rejectUnauthorized: false }`
     * for VPC connections without a certificate).
     */
    ssl?: boolean | Record<string, unknown>;
  };

  /** Embedded API server. Default: enabled on port 3000. */
  server?: {
    enabled?: boolean;
    port?: number;
  };

  /**
   * Workflow workers to start. Each entry registers a worker on the given queue.
   *
   * Pass a function for normal workers. Pass a **string name** with
   * `connection: { readonly: true }` for dashboard/observer mode — a no-op
   * worker is created automatically so the workflow appears in discovery
   * and can be invoked without competing for work.
   *
   * @example
   * ```typescript
   * workers: [
   *   // Normal worker — runs the workflow
   *   { taskQueue: 'my-queue', workflow: myWorkflow },
   *   // Readonly observer — discovers and invokes without competing for work
   *   { taskQueue: 'ingest', workflow: 'orderPipeline', connection: { readonly: true } },
   * ]
   * ```
   */
  workers?: Array<{
    taskQueue: string;
    /** Workflow function, or a string name when registering a readonly observer. */
    workflow: ((...args: any[]) => any) | string;
    /**
     * Optional overrides merged onto the HotMesh connection/provider config.
     * Common fields: `readonly` (observe without consuming work),
     * `retry` (stream-level retry policy with backoff).
     */
    connection?: { readonly?: boolean; retry?: Record<string, unknown> };
    /** Inline workflow profile — auto-seeds dashboard forms, roles, and tier on startup. */
    config?: LTWorkerConfig;
  }>;

  /** Interceptor defaults applied when a workflow escalates. */
  interceptor?: {
    defaultRole?: string;
  };

  /**
   * Dashboard feature flags. Defaults are permissive (everything shown); set a
   * flag to `false` to hide that affordance. Surfaced to the dashboard via
   * `/api/settings` as `features`.
   */
  features?: {
    /** Show the DB Maintenance admin page (nav + route). Default: true. */
    dbMaintenance?: boolean;
  };

  /** Authentication. Defaults to the built-in JWT adapter using JWT_SECRET. */
  auth?: {
    /** JWT secret for the built-in adapter. */
    secret?: string;
    /** Replace the built-in JWT adapter entirely. */
    adapter?: LTAuthAdapter;
    /** OAuth/OIDC configuration for identity and resource OAuth. */
    oauth?: LTOAuthStartConfig;
    /** SSO for embedded deployments. Host auth is trusted; users are
     *  JIT-provisioned in lt_users from the resolved identity. */
    sso?: LTSSOConfig;
  };

  /** OpenTelemetry. Register before workers start. */
  telemetry?: {
    honeycomb?: { apiKey: string; serviceName?: string; endpoint?: string; traceUrl?: string };
    adapter?: LTTelemetryAdapter;
  };

  /** Milestone event publishing. */
  events?: {
    nats?: {
      url?: string;
      wsUrl?: string;
      /** Internal NATS WebSocket target to proxy through this server (e.g. ws://nats:9222). Enables the /nats-ws proxy route. */
      wsProxy?: string;
      subjectPrefix?: string;
      token?: string;
    };
    adapters?: LTEventAdapter[];
  };

  /** Structured logging. Defaults to console.* when omitted. */
  logging?: {
    pino?: LoggerOptions;
    adapter?: LTLoggerAdapter;
  };

  /**
   * Database maintenance schedule (opt-in).
   * - `true` → default weekly Sunday 2 AM cleanup
   * - `false` or `undefined` → disabled (default)
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
   * Seed data applied after migrations, before workers start.
   *
   * `admin` creates a superadmin user on first boot (idempotent).
   * The seeded user's UUID is returned as `LTInstance.adminUserId`
   * so callers can pass it directly to `createClient()`.
   *
   * @example
   * ```typescript
   * const lt = await start({
   *   database: { connectionString: dbUrl },
   *   seed: {
   *     admin: {
   *       externalId: 'system',
   *       displayName: 'System',
   *       email: 'system@app.internal',
   *     },
   *   },
   *   workers: [...],
   * });
   *
   * const client = createClient({ auth: { userId: lt.adminUserId } });
   * ```
   */
  seed?: {
    admin?: {
      /** Unique external identifier for the admin user. */
      externalId: string;
      /** Display name. Defaults to externalId if omitted. */
      displayName?: string;
      /** Email address. Optional. */
      email?: string;
      /** Initial password. Optional — omit for service accounts that never log in. */
      password?: string;
    };
  };

  /**
   * Load example workflows and seed sample data on startup.
   * When `true`, appends the built-in example workers and starts
   * a few sample workflows so the dashboard has data immediately.
   */
  examples?: boolean;

  /** Declarative topic catalog entries. Seeded on first boot (insert-if-absent). */
  topics?: LTTopicConfig[];

  /** Declarative agent configurations. Seeded on first boot (insert-if-absent). */
  agents?: LTAgentConfig[];

  /**
   * Declarative graph (YAML/DAG) workflows — the graph-form peer of `workers`.
   * Each is created (insert-if-absent), deployed, and activated at startup with
   * no MCP/LLM Designer involved. Hand-author the HotMesh YAML and it runs.
   */
  graphWorkflows?: LTGraphWorkflowConfig[];

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
    /**
     * Custom MCP server factories to register alongside the built-in ones.
     * Key = server name, value = factory function or `{ factory, config }` object.
     * When `config` is provided, the server definition is auto-seeded into
     * `lt_mcp_servers` at startup (tags, compile hints, credential providers, tool manifest).
     */
    serverFactories?: Record<string, (() => any) | { factory: () => any; config: LTMcpServerConfig }>;
    /** Replace the built-in MCP adapter entirely. */
    adapter?: LTMcpAdapter;
    /**
     * Controls which tools are exposed when this instance acts as an MCP server.
     * All fields are optional — omit the entire object for unrestricted access.
     */
    exposure?: {
      /** Only expose tools marked `read_safe: true`. Default: false. */
      readOnly?: boolean;
      /** Hide servers with `aiRequired: true` when no AI API key is configured. Default: true. */
      hideAiWhenUnavailable?: boolean;
      /** When set, only these server IDs are exposed. */
      allowServers?: string[];
      /** Server IDs to exclude from exposure. */
      denyServers?: string[];
    };
  };
}

export interface LTInstance {
  /** Durable client for starting workflows and querying state. */
  client: any;
  /** Graceful shutdown — stops workers, server, and adapters. */
  shutdown: () => Promise<void>;
  /**
   * UUID of the seeded admin user (when `seed.admin` was provided).
   * Pass to `createClient({ auth: { userId: adminUserId } })`.
   */
  adminUserId?: string;
}
