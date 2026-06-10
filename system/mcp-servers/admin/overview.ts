/**
 * System overview tool — one call, complete picture.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getSystemOverview } from '../../../services/overview';

export const systemOverviewSchema = z.object({
  period: z.enum(['1h', '24h', '7d']).optional().default('24h')
    .describe('Time window for trends and throughput metrics'),
});

export function registerOverviewTools(server: McpServer): void {
  (server as any).registerTool(
    'get_system_overview',
    {
      title: 'Get System Overview',
      description:
        'Triage-ready system dashboard in one call. Returns escalation queue pressure ' +
        '(aging, unclaimed, by role), task throughput (created/completed/failed), ' +
        'hourly trends (escalation creation, task completion, resolution velocity), ' +
        'infrastructure status (MCP servers, agents, compiled workflows), and ' +
        'business process summary. Use this as the first call to understand system state.',
      inputSchema: systemOverviewSchema,
    },
    async (args: z.infer<typeof systemOverviewSchema>) => {
      try {
        const overview = await getSystemOverview(args.period);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(overview) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }],
          isError: true,
        };
      }
    },
  );
}
