import { Wand2, Blocks, Route } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/mcp/queries', label: 'Designer', icon: Wand2 },
  { to: '/mcp/servers', label: 'Servers & Tools', icon: Blocks },
  { to: '/mcp/workflows', label: 'Pipeline Tools', icon: Route },
];

export function DesignSidebar() {
  return <SidebarNav heading="Design" entries={entries} />;
}
