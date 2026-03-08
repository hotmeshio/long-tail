import { Wrench, Server, FileCode, Play } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/mcp/servers', label: 'Servers', icon: Server },
  { to: '/mcp/tools', label: 'Tools', icon: Wrench },
  { to: '/mcp/pipelines', label: 'Pipelines', icon: FileCode },
  { to: '/mcp/runs', label: 'Runs', icon: Play },
];

export function McpSidebar() {
  return <SidebarNav heading="MCP" entries={entries} />;
}
