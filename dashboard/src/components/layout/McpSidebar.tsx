import { Server, ServerCog, GitBranch } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/mcp/servers', label: 'Servers', icon: Server },
  { to: '/mcp/workflows', label: 'Workflow Servers', icon: ServerCog },
  { to: '/mcp/runs', label: 'Workflow Runs', icon: GitBranch },
];

export function McpSidebar() {
  return <SidebarNav heading="MCP" headingTo="/mcp" entries={entries} />;
}
