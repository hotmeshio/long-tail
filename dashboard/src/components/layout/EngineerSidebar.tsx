import { GitBranch, Play, Clock, Settings } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/workflows/runs', label: 'Workflow Runs', icon: GitBranch },
  { to: '/workflows/start', label: 'Start', icon: Play },
  { to: '/workflows/cron', label: 'Cron', icon: Clock },
  { to: '/workflows/config', label: 'Config', icon: Settings },
];

export function EngineerSidebar() {
  return <SidebarNav heading="Durable Workflows" headingTo="/workflows" entries={entries} />;
}
