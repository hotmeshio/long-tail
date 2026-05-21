import { Zap, Activity, Bot, Radio } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/', label: 'Recent Activity', icon: Activity, end: true },
  { to: '/capabilities', label: 'Capabilities', icon: Zap },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/topics', label: 'Topics', icon: Radio },
];

export function WorkSidebar() {
  return <SidebarNav heading="Work" entries={entries} />;
}
