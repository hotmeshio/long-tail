import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../logger';

let server: McpServer | null = null;

const HONEYCOMB_UI_BASE = 'https://ui.honeycomb.io';

function getTeam(): string {
  return process.env.HONEYCOMB_TEAM || '';
}

function getEnvironment(): string {
  return process.env.HONEYCOMB_ENVIRONMENT || '';
}

function getDataset(): string {
  return process.env.HONEYCOMB_DATASET || 'long-tail';
}

/**
 * Build a Honeycomb UI trace URL.
 * Format: https://ui.honeycomb.io/{team}/environments/{env}/datasets/{dataset}/trace?trace_id={traceId}
 */
function buildTraceUrl(opts: {
  trace_id: string;
  span_id?: string;
  dataset?: string;
}): string {
  const team = getTeam();
  const env = getEnvironment();
  const dataset = opts.dataset || getDataset();

  if (!team || !env) {
    throw new Error(
      'Honeycomb UI link requires HONEYCOMB_TEAM and HONEYCOMB_ENVIRONMENT env vars. ' +
      'Set these to your Honeycomb team slug and environment slug (found in your Honeycomb URL).',
    );
  }

  const url = new URL(
    `${HONEYCOMB_UI_BASE}/${team}/environments/${env}/datasets/${dataset}/trace`,
  );
  url.searchParams.set('trace_id', opts.trace_id);
  if (opts.span_id) {
    url.searchParams.set('span', opts.span_id);
  }
  return url.toString();
}

// ── Schema ───────────────────────────────────────────────────────────────

const getTraceLinkSchema = z.object({
  trace_id: z.string().describe('The OpenTelemetry trace ID'),
  span_id: z.string().optional().describe('Optional span ID to highlight in the trace view'),
  dataset: z.string().optional().describe('Honeycomb dataset (defaults to "long-tail")'),
});

/**
 * Create the Long Tail Telemetry MCP server.
 *
 * Provides a single tool:
 * - get_trace_link — generate a direct Honeycomb UI link for a trace
 */
export async function createTelemetryServer(options?: {
  name?: string;
}): Promise<McpServer> {
  if (server) return server;

  const name = options?.name || 'long-tail-telemetry';
  server = new McpServer({ name, version: '1.0.0' });

  // ── get_trace_link ─────────────────────────────────────────────────
  (server as any).registerTool(
    'get_trace_link',
    {
      title: 'Get Trace Link',
      description:
        'Generate a direct link to view a trace in the Honeycomb UI. ' +
        'Returns a URL that opens the trace visualization showing the full span DAG ' +
        'with durations, errors, and parent-child relationships. ' +
        'Optionally highlight a specific span by providing span_id.',
      inputSchema: getTraceLinkSchema,
    },
    async (args: z.infer<typeof getTraceLinkSchema>) => {
      try {
        const url = buildTraceUrl({
          trace_id: args.trace_id,
          span_id: args.span_id,
          dataset: args.dataset,
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              trace_id: args.trace_id,
              honeycomb_url: url,
              dataset: args.dataset || getDataset(),
            }),
          }],
        };
      } catch (err: any) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: err.message }),
          }],
          isError: true,
        };
      }
    },
  );

  loggerRegistry.info(`[lt-mcp:telemetry-server] ${name} ready (1 tool registered)`);
  return server;
}

/**
 * Get the current Telemetry MCP server instance.
 */
export function getTelemetryServer(): McpServer | null {
  return server;
}

/**
 * Stop the Telemetry MCP server and release resources.
 */
export async function stopTelemetryServer(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
    loggerRegistry.info('[lt-mcp:telemetry-server] stopped');
  }
}
