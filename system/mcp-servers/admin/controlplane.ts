/**
 * Control plane tools — mirrors routes/controlplane.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as api from '../../../api/controlplane';
import {
  listAppsSchema,
  rollCallSchema,
  applyThrottleSchema,
  getStreamStatsSchema,
  listStreamMessagesSchema,
} from './schemas';

export function registerControlPlaneTools(server: McpServer): void {

  // mirrors GET /api/controlplane/apps
  (server as any).registerTool(
    'list_apps',
    {
      title: 'List Apps',
      description: 'List available HotMesh application namespaces.',
      inputSchema: listAppsSchema,
    },
    async (_args: z.infer<typeof listAppsSchema>) => {
      const result = await api.listApps();
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors GET /api/controlplane/rollcall
  (server as any).registerTool(
    'rollcall',
    {
      title: 'Roll Call',
      description:
        'Execute a roll call — discovers all engines and workers in the mesh. ' +
        'Returns topology of active participants.',
      inputSchema: rollCallSchema,
    },
    async (args: z.infer<typeof rollCallSchema>) => {
      const result = await api.rollCall({
        appId: args.app_id || 'durable',
        delay: args.delay,
      });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/controlplane/throttle
  (server as any).registerTool(
    'apply_throttle',
    {
      title: 'Apply Throttle',
      description:
        'Apply a throttle to the mesh. Values: -1 = pause, 0 = resume, ' +
        '>0 = delay in ms per message.',
      inputSchema: applyThrottleSchema,
    },
    async (args: z.infer<typeof applyThrottleSchema>) => {
      const result = await api.applyThrottle(args as any);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors GET /api/controlplane/streams
  (server as any).registerTool(
    'get_stream_stats',
    {
      title: 'Get Stream Stats',
      description:
        'Stream processing statistics — pending count and processed volume ' +
        'by time range.',
      inputSchema: getStreamStatsSchema,
    },
    async (args: z.infer<typeof getStreamStatsSchema>) => {
      const result = await api.getStreamStats(args);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors GET /api/controlplane/stream-messages
  (server as any).registerTool(
    'list_stream_messages',
    {
      title: 'List Stream Messages',
      description:
        'Browse stream messages with pagination, filtering, and sorting. ' +
        'Both namespace and source are required.',
      inputSchema: listStreamMessagesSchema,
    },
    async (args: z.infer<typeof listStreamMessagesSchema>) => {
      const result = await api.listStreamMessages(args as any);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );
}
