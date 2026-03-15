import { Server, Workflow, GitBranch } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/mcp/servers', label: 'Server Tools', icon: Server },
  { to: '/mcp/workflows', label: 'Workflow Tools', icon: Workflow },
  { to: '/mcp/executions', label: 'Executions', icon: GitBranch },
];

export function McpSidebar() {
  return <SidebarNav heading="MCP Tools" headingTo="/mcp" entries={entries} />;
}
