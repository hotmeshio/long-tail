/** Type definitions for the MCP (Model Context Protocol) service. */

export interface CreateMcpServerInput {
  name: string;
  description?: string;
  transport_type: 'stdio' | 'sse';
  transport_config: Record<string, any>;
  auto_connect?: boolean;
  metadata?: Record<string, any>;
  tags?: string[];
}

export interface BuiltInMcpAdapterOptions {
  server?: {
    enabled?: boolean;
    name?: string;
  };
  autoConnect?: string[];
}
