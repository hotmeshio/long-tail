import { Play, Settings, GitBranch } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/workflows/registry', label: 'Worker Registry', icon: Settings },
  { to: '/workflows/start', label: 'Invoke', icon: Play },
  { to: '/workflows/executions', label: 'Executions', icon: GitBranch },
];

export function UnbreakableSidebar() {
  return <SidebarNav heading="Unbreakable Workflows" entries={entries} />;
}
