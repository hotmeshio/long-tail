/** Type definitions for the MCP (Model Context Protocol) service. */

export interface CreateMcpServerInput {
  name: string;
  description?: string;
  transport_type: 'stdio' | 'sse' | 'streamable-http';
  transport_config: Record<string, any>;
  auto_connect?: boolean;
  metadata?: Record<string, any>;
  tags?: string[];
  compile_hints?: string;
  credential_providers?: string[];
}

export interface BuiltInMcpAdapterOptions {
  server?: {
    enabled?: boolean;
    name?: string;
  };
  autoConnect?: string[];
}
