import { Server } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/mcp/servers', label: 'Servers & Tools', icon: Server },
];

export function McpServersSidebar() {
  return <SidebarNav heading="MCP" entries={entries} />;
}
