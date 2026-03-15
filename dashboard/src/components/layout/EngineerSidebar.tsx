import { GitBranch, Play, Clock, Settings } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/workflows/registry', label: 'Registry', icon: Settings },
  { to: '/workflows/start', label: 'Start', icon: Play },
  { to: '/workflows/cron', label: 'Cron', icon: Clock },
  { to: '/workflows/executions', label: 'Executions', icon: GitBranch },
];

export function EngineerSidebar() {
  return <SidebarNav heading="Workflows" headingTo="/workflows" entries={entries} />;
}
