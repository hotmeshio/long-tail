import { ListChecks, Play, Settings, UserCheck } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/workflows/registry', label: 'Workflow Registry', icon: Settings },
  { to: '/workflows/start', label: 'Invoke Workflow', icon: Play },
  { to: '/escalations/available', label: 'Escalations', icon: UserCheck },
  { to: '/workflows/executions', label: 'Durable Executions', icon: ListChecks },
];

export function EngineerSidebar() {
  return <SidebarNav heading="Durable Workflows" entries={entries} />;
}
