import { Workflow, GitBranch, Wand2 } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/mcp/workflows', label: 'Pipeline Registry', icon: Workflow },
  { to: '/mcp/queries', label: 'Invoke', icon: Wand2 },
  { to: '/mcp/executions', label: 'Executions', icon: GitBranch },
];

export function McpSidebar() {
  return <SidebarNav heading="Discover Workflows" entries={entries} />;
}
