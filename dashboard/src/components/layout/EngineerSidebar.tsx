import { GitBranch, Play, Clock, Settings } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/workflows/registry', label: 'Register', icon: Settings },
  { to: '/workflows/start', label: 'Invoke', icon: Play },
  { to: '/workflows/cron', label: 'Cron', icon: Clock },
  { to: '/workflows/executions', label: 'Executions', icon: GitBranch },
];

export function EngineerSidebar() {
  return <SidebarNav heading="Durable Workflows" headingTo="/workflows" entries={entries} />;
}
