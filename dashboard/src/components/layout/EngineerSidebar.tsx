import { GitBranch, Play, Server } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/workflows/workers', label: 'All Workers', icon: Server },
  { to: '/workflows/durable/invoke', label: 'Invoke', icon: Play },
  { to: '/workflows/durable/executions', label: 'Executions', icon: GitBranch },
];

export function EngineerSidebar() {
  return <SidebarNav heading="Durable Workflows" entries={entries} />;
}
