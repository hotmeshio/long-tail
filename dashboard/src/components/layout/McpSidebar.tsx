import { Server, Workflow, GitBranch, Sparkles } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/mcp/queries', label: 'Discover & Compile', icon: Sparkles },
  { to: '/mcp/servers', label: 'Tool Servers', icon: Server },
  { to: '/mcp/workflows', label: 'Compiled Pipelines', icon: Workflow },
  { to: '/mcp/executions', label: 'Pipeline Runs', icon: GitBranch },
];

export function McpSidebar() {
  return <SidebarNav heading="Discovery" headingTo="/mcp" entries={entries} />;
}
