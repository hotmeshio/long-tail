import { LayoutDashboard, Route } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/', label: 'Dashboard', end: true, icon: LayoutDashboard },
  { to: '/processes/list', label: 'Processes', icon: Route },
];

export function ProcessesSidebar() {
  return <SidebarNav heading="Processes" entries={entries} />;
}
