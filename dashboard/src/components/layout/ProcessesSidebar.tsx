import { Route } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/processes/all', label: 'All Processes', icon: Route },
];

export function ProcessesSidebar() {
  return <SidebarNav heading="Processes" headingTo="/" entries={entries} />;
}
