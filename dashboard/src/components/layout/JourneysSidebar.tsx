import { LayoutDashboard, Route } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/', label: 'Dashboard', end: true, icon: LayoutDashboard },
  { to: '/segments', label: 'Segments', icon: Route },
];

export function JourneysSidebar() {
  return <SidebarNav heading="Segments" entries={entries} />;
}
