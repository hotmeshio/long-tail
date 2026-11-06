import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';

import { getEscalationLookups } from '../../api/escalations/lookups';
import { callerAuth, type ToolCallExtra } from './caller-auth';
import { getEscalationLookupsSchema } from './human-queue-schemas';

/**
 * get_escalation_lookups: the editions pinned on a row, for anyone who may read
 * the row. Runs the same read check as GET /api/escalations/:id/lookups, as the
 * /mcp caller, else lt-system for an internal call.
 */
export function registerEscalationLookupsTool(server: McpServer): void {
  (server as any).registerTool(
    'get_escalation_lookups',
    {
      title: 'Get Escalation Lookups',
      description:
        'Resolve the versioned knowledge lookups pinned on an escalation (envelope.lookups), ' +
        'for a caller who may read the escalation. Each ref answers with its edition; a ref ' +
        'whose snapshot does not exist answers with missing: true.',
      inputSchema: getEscalationLookupsSchema,
    },
    async (args: z.infer<typeof getEscalationLookupsSchema>, extra?: ToolCallExtra) => {
      const result = await getEscalationLookups({ id: args.escalation_id }, await callerAuth(extra));
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ escalation_id: args.escalation_id, ...result.data }),
        }],
      };
    },
  );
}
