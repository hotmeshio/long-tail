import { GitBranch, Play, Clock } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/workflows/list', label: 'Workflows', icon: GitBranch },
  { to: '/workflows/start', label: 'Start Workflow', icon: Play },
  { to: '/workflows/cron', label: 'Cron', icon: Clock },
];

export function EngineerSidebar() {
  return <SidebarNav heading="Durable Workflows" headingTo="/workflows" entries={entries} />;
}
