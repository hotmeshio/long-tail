/**
 * Dashboard announcement tool — mirrors routes/announcements.ts. Publishing
 * is a privileged surface (the HTTP route guards with requireRoleManager);
 * targeting is display scoping only, so bodies must never carry secrets.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as api from '../../../api/announcements';

const publishAnnouncementSchema = z.object({
  body: z.string().describe('Markdown body — the only required field.'),
  title: z.string().optional().describe('Headline shown on the collapsed banner.'),
  layout: z.string().optional().describe("Presentation form. Default: 'banner'."),
  roles: z.array(z.string()).optional().describe('Target roles; omitted = everyone.'),
  expires_at: z.string().optional().describe('ISO timestamp; omitted = 24 hours from now.'),
});

export function registerAnnouncementTools(server: McpServer): void {

  // mirrors POST /api/announcements
  (server as any).registerTool(
    'publish_announcement',
    {
      title: 'Publish Announcement',
      description:
        'Publish a dashboard announcement — a banner every targeted user sees ' +
        'live and on their next load until it expires or is dismissed. Only ' +
        'the body is required; title, layout, role targeting, and expiry ' +
        '(default 24h) are optional. Bodies broadcast to all authenticated ' +
        'subscribers — never include secrets.',
      inputSchema: publishAnnouncementSchema,
    },
    async (args: z.infer<typeof publishAnnouncementSchema>) => {
      const result = await api.createAnnouncement(
        {
          body: args.body,
          title: args.title,
          layout: args.layout,
          roles: args.roles,
          expiresAt: args.expires_at,
        },
        { userId: 'lt-system', role: 'superadmin' },
      );
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );
}
