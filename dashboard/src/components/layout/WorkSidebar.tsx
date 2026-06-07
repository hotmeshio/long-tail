import { Zap, Activity, Bot, Radio } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

export function WorkSidebar({ aiEnabled = false, isBuilder = false }: { aiEnabled?: boolean; isBuilder?: boolean }) {
  const entries: NavEntry[] = [
    { to: '/', label: 'Recent Activity', icon: Activity, end: true },
  ];

  if (isBuilder) {
    entries.push(
      { to: '/capabilities', label: 'Capabilities', icon: Zap },
      { to: '/agents', label: aiEnabled ? 'Agents' : 'Automations', icon: Bot },
      { to: '/topics', label: 'Topics', icon: Radio },
    );
  }

  return <SidebarNav heading="Work" entries={entries} />;
}
