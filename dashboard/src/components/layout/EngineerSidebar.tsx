import { LayoutDashboard, GitBranch, Play, Clock, FileCode } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/workflows', label: 'Dashboard', end: true, icon: LayoutDashboard },
  { to: '/workflows/list', label: 'Workflows', icon: GitBranch },
  { to: '/workflows/start', label: 'Start Workflow', icon: Play },
  { to: '/workflows/cron', label: 'Cron', icon: Clock },
  { to: '/workflows/yaml', label: 'YAML Workflows', icon: FileCode },
];

export function EngineerSidebar() {
  return <SidebarNav heading="Workflows" entries={entries} />;
}
