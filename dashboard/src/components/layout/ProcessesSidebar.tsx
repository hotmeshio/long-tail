import { Route } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/processes/list', label: 'Processes', icon: Route },
];

export function ProcessesSidebar() {
  return <SidebarNav heading="Business Processes" headingTo="/" entries={entries} />;
}
