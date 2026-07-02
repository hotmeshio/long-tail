import { Zap, Bot, Radio, Inbox, ListChecks, LayoutDashboard } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

/**
 * "React" — the reactive, event-driven surface (choreography).
 * Builders configure automations, topics, and capabilities here. Operators,
 * who don't build, get their escalation queue (home is also one logo click away).
 * Operations (COO view) is the first entry for admins and builders.
 */
export function ChoreographySidebar({
  aiEnabled = false,
  isBuilder = false,
  isOps = false,
}: {
  aiEnabled?: boolean;
  isBuilder?: boolean;
  isOps?: boolean;
}) {
  if (!isBuilder && !isOps) {
    const operatorEntries: NavEntry[] = [
      { to: '/escalations/queue', label: 'My Queue', icon: Inbox },
      { to: '/escalations/available', label: 'Available', icon: ListChecks },
    ];
    return <SidebarNav heading="Work" entries={operatorEntries} />;
  }

  if (!isBuilder) {
    // isOps but not builder — only show Operations
    return <SidebarNav heading="React" entries={[{ to: '/operations', label: 'Operations', icon: LayoutDashboard }]} />;
  }

  const entries: NavEntry[] = [
    ...(isOps || isBuilder ? [{ to: '/operations', label: 'Operations', icon: LayoutDashboard } as NavEntry] : []),
    { to: '/topics', label: 'Event Topics', icon: Radio },
    { to: '/agents', label: aiEnabled ? 'Agents' : 'Automations', icon: Bot },
    { to: '/capabilities', label: 'Capabilities', icon: Zap },
  ];

  return <SidebarNav heading="React" entries={entries} />;
}
