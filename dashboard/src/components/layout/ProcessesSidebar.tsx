import { Route } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/processes/runs', label: 'Process Runs', icon: Route },
];

export function ProcessesSidebar() {
  return <SidebarNav heading="Business Processes" headingTo="/" entries={entries} />;
}
