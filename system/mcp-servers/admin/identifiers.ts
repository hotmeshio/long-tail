/** Identifier binding tools, read only; they mirror routes/identifiers.ts. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as identifiersApi from '../../../api/identifiers';
import { listIdentifierBindingsSchema } from './schemas';

export function registerIdentifierTools(server: McpServer): void {

  // mirrors GET /api/identifiers/:scheme/bindings
  (server as any).registerTool(
    'list_identifier_bindings',
    {
      title: 'List Identifier Bindings',
      description: 'List a scan scheme\'s identifier bindings (a scanned value paired with the thing it stands for): live ones by default, newest first. raw answers one value\'s live target.',
      inputSchema: listIdentifierBindingsSchema,
    },
    async (args: z.infer<typeof listIdentifierBindingsSchema>) => {
      const result = await identifiersApi.listIdentifierBindings(args);
      return { ...(result.error ? { isError: true } : {}), content: [{ type: 'text' as const, text: JSON.stringify(result.data ?? { error: result.error }) }] };
    },
  );
}
