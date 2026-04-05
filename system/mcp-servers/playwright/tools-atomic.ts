import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerNavigationTools } from './tools-navigation';
import { registerPageInteractionTools } from './tools-page-interaction';

export function registerAtomicTools(srv: McpServer): void {
  registerNavigationTools(srv);
  registerPageInteractionTools(srv);
}
