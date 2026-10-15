import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * The client transport for a network MCP server. `headers` ride every
 * request (the SSE stream and its POSTs alike), which is how a server that
 * authenticates its callers, such as another Long Tail's /mcp with a
 * service-account key, is reached.
 */
export function createNetworkTransport(
  transportType: 'sse' | 'streamable-http',
  config: { url?: string; headers?: Record<string, string> },
): SSEClientTransport | StreamableHTTPClientTransport {
  if (!config.url) throw new Error('A network MCP server needs a url');
  const url = new URL(config.url);
  const requestInit = config.headers && Object.keys(config.headers).length ? { headers: config.headers } : undefined;
  return transportType === 'streamable-http'
    ? new StreamableHTTPClientTransport(url, { requestInit })
    : new SSEClientTransport(url, { requestInit });
}
