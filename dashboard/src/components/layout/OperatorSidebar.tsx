import { LayoutDashboard, AlertTriangle, Inbox } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/escalations', label: 'Dashboard', end: true, icon: LayoutDashboard },
  { to: '/escalations/available', label: 'All Escalations', icon: AlertTriangle },
  { to: '/escalations/queue', label: 'My Escalations', icon: Inbox },
];

export function OperatorSidebar() {
  return <SidebarNav heading="Escalations" entries={entries} />;
}
