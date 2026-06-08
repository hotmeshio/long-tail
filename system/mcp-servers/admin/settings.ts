/**
 * Settings tool — mirrors routes/settings.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as api from '../../../api/settings';
import { getSettingsSchema } from './schemas';

export function registerSettingsTools(server: McpServer): void {

  // mirrors GET /api/settings
  (server as any).registerTool(
    'get_settings',
    {
      title: 'Get Settings',
      description:
        'Get frontend-relevant configuration (no secrets). Returns feature flags, ' +
        'enabled capabilities, and system metadata.',
      inputSchema: getSettingsSchema,
    },
    async (_args: z.infer<typeof getSettingsSchema>) => {
      const result = await api.getSettings();
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );
}
