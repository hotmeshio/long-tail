/**
 * Database maintenance tools — mirrors routes/dba.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as dbaService from '../../../services/dba';
import { pruneSchema } from './schemas';

export function registerMaintenanceTools(server: McpServer): void {

  // mirrors POST /api/dba/prune
  (server as any).registerTool(
    'prune',
    {
      title: 'Prune Database',
      description:
        'Prune expired jobs, streams, and execution artifacts. Returns ' +
        'the count of records affected by each operation.',
      inputSchema: pruneSchema,
    },
    async (args: z.infer<typeof pruneSchema>) => {
      const result = await dbaService.prune({
        expire: args.expire,
        jobs: args.jobs,
        streams: args.streams,
        entities: args.entities,
        pruneTransient: args.prune_transient,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
}
