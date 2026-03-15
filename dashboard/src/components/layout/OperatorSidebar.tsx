import { AlertTriangle, Inbox } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/escalations/available', label: 'Available', icon: AlertTriangle },
  { to: '/escalations/queue', label: 'Mine', icon: Inbox },
];

export function OperatorSidebar() {
  return <SidebarNav heading="Escalations" headingTo="/escalations" entries={entries} />;
}
