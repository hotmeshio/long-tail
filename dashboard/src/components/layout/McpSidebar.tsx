import { Cpu, Wrench, Server } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/mcp', label: 'Dashboard', end: true, icon: Cpu },
  { to: '/mcp/servers', label: 'Servers', icon: Server },
  { to: '/mcp/tools', label: 'Tools', icon: Wrench },
];

export function McpSidebar() {
  return <SidebarNav heading="MCP" entries={entries} />;
}
