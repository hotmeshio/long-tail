import { Zap, Bot, Radio, Inbox, ListChecks } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

/**
 * "If This Then That" — the reactive, event-driven surface (choreography).
 * Builders configure automations, topics, and capabilities here. Operators,
 * who don't build, get their escalation queue (home is also one logo click away).
 */
export function ChoreographySidebar({ aiEnabled = false, isBuilder = false }: { aiEnabled?: boolean; isBuilder?: boolean }) {
  if (!isBuilder) {
    const operatorEntries: NavEntry[] = [
      { to: '/escalations/queue', label: 'My Queue', icon: Inbox },
      { to: '/escalations/available', label: 'Available', icon: ListChecks },
    ];
    return <SidebarNav heading="Work" entries={operatorEntries} />;
  }

  const entries: NavEntry[] = [
    { to: '/agents', label: aiEnabled ? 'Agents' : 'Automations', icon: Bot },
    { to: '/topics', label: 'Topics', icon: Radio },
    { to: '/capabilities', label: 'Capabilities', icon: Zap },
  ];

  return <SidebarNav heading="If This Then That" entries={entries} />;
}
