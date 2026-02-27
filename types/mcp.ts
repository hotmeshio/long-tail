/**
 * MCP server transport type.
 * - 'stdio'  — spawn a child process (command + args)
 * - 'sse'    — connect to an SSE endpoint (url)
 */
export type LTMcpTransportType = 'stdio' | 'sse';

/**
 * MCP server registration as stored in the database (snake_case).
 */
export interface LTMcpServerRecord {
  id: string;
  name: string;
  description: string | null;
  transport_type: LTMcpTransportType;
  transport_config: {
    /** For stdio: the command to spawn */
    command?: string;
    /** For stdio: arguments to the command */
    args?: string[];
    /** For stdio: environment variables to set */
    env?: Record<string, string>;
    /** For sse: the URL to connect to */
    url?: string;
  };
  /** Whether to auto-connect on startup */
  auto_connect: boolean;
  /** Cached tool manifest from last listTools() */
  tool_manifest: LTMcpToolManifest[] | null;
  metadata: Record<string, any> | null;
  status: LTMcpServerStatus;
  last_connected_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type LTMcpServerStatus = 'registered' | 'connected' | 'error' | 'disconnected';

/**
 * Cached tool manifest entry from listTools().
 */
export interface LTMcpToolManifest {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

/**
 * MCP adapter interface. Follows the same pattern as
 * LTTelemetryAdapter (single-adapter, connect/disconnect).
 *
 * The adapter manages:
 * - One MCP server (human queue) exposing Long Tail escalations
 * - Multiple MCP client connections to external servers
 */
export interface LTMcpAdapter {
  /** Start the MCP server and connect all auto-connect clients */
  connect(): Promise<void>;
  /** Disconnect all clients and stop the server */
  disconnect(): Promise<void>;
  /** Connect to a registered MCP server by name or ID */
  connectClient(serverId: string): Promise<void>;
  /** Disconnect a specific client */
  disconnectClient(serverId: string): Promise<void>;
  /** List tools from a connected server */
  listTools(serverId: string): Promise<LTMcpToolManifest[]>;
  /** Call a tool on a connected server */
  callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<any>;
  /**
   * Return an object of tool functions suitable for
   * Durable.workflow.proxyActivities(). Each key is a tool name
   * and each value is an async function wrapping callTool().
   */
  toolActivities(serverId: string): Promise<Record<string, (...args: any[]) => Promise<any>>>;
}
