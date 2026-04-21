import { Server, Workflow, ListChecks, Wand2 } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/mcp/queries', label: 'MCP Tool Designer', icon: Wand2 },
  { to: '/mcp/servers', label: 'MCP Server Tools', icon: Server },
  { to: '/mcp/workflows', label: 'MCP Pipeline Tools', icon: Workflow },
  { to: '/mcp/executions', label: 'Pipeline Executions', icon: ListChecks },
];

export function McpSidebar() {
  return <SidebarNav heading="MCP Workflows" entries={entries} />;
}
