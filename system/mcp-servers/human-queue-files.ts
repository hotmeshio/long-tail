import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';

import { getEscalationFiles } from '../../api/escalations/files';
import { callerAuth, type ToolCallExtra } from './caller-auth';
import { getEscalationFilesSchema } from './human-queue-schemas';

/**
 * get_escalation_files: time-limited links to the stored files a row names,
 * for anyone who may read the row. Runs the same read check as
 * GET /api/escalations/:id/files, as the /mcp caller, else lt-system for an
 * internal call.
 */
export function registerEscalationFilesTool(server: McpServer): void {
  (server as any).registerTool(
    'get_escalation_files',
    {
      title: 'Get Escalation Files',
      description:
        'Sign the stored files an escalation names (envelope.files), for a caller who may read ' +
        'the escalation. Each ref answers with a time-limited url, its expiresAt, name and ' +
        'contentType; a ref that cannot be signed answers with error.',
      inputSchema: getEscalationFilesSchema,
    },
    async (args: z.infer<typeof getEscalationFilesSchema>, extra?: ToolCallExtra) => {
      const result = await getEscalationFiles({ id: args.escalation_id }, await callerAuth(extra));
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
