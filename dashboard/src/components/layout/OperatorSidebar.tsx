import { AlertTriangle, Inbox } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/escalations/available', label: 'All Escalations', icon: AlertTriangle },
  { to: '/escalations/queue', label: 'My Escalations', icon: Inbox },
];

export function OperatorSidebar() {
  return <SidebarNav heading="HITL Escalations" headingTo="/escalations" entries={entries} />;
}
