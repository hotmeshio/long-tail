import { LayoutDashboard, GitBranch, Play } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/workflows', label: 'Overview', end: true, icon: LayoutDashboard },
  { to: '/workflows/list', label: 'Workflows', icon: GitBranch },
  { to: '/workflows/start', label: 'Start Workflow', icon: Play },
];

export function EngineerSidebar() {
  return <SidebarNav heading="Workflows" entries={entries} />;
}
