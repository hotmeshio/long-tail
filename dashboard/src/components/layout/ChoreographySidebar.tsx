import { Zap, Bot, Radio, Inbox, ListChecks, LayoutDashboard } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';
import type { ViewAsRole } from '../../lib/view-as';

const OPERATOR_ENTRIES: NavEntry[] = [
  { to: '/escalations/queue', label: 'My Queue', icon: Inbox },
  { to: '/escalations/available', label: 'All', icon: ListChecks },
];

/**
 * "Monitor" — the reactive, event-driven surface (choreography).
 * Builders configure automations, topics, and capabilities here. Operators,
 * who don't build, get their escalation queue (home is also one logo click away).
 * Operations (COO view) is the first entry for admins and builders.
 *
 * `viewAs` overrides the rendered variant when the user is simulating a lower role:
 * - 'engineer' → shows the Work queue (even though isOps=true)
 * - 'admin'    → shows the Pace Board (same as the isOps branch)
 * - 'operator' → shows the Work queue (same as the operator branch)
 */
export function ChoreographySidebar({
  aiEnabled = false,
  isBuilder = false,
  isOps = false,
  viewAs = null,
}: {
  aiEnabled?: boolean;
  isBuilder?: boolean;
  isOps?: boolean;
  viewAs?: ViewAsRole | null;
}) {
  // Operator or engineer view: show work queue
  if (!isBuilder && (!isOps || viewAs === 'engineer' || viewAs === 'operator')) {
    return <SidebarNav heading="Work" entries={OPERATOR_ENTRIES} />;
  }

  if (!isBuilder) {
    // Admin/ops only (not builder) — pace board
    return <SidebarNav heading="Monitor" entries={[{ to: '/operations', label: 'Pace Board', icon: LayoutDashboard }]} />;
  }

  // Full builder view
  const entries: NavEntry[] = [
    ...(isOps || isBuilder ? [{ to: '/operations', label: 'Pace Board', icon: LayoutDashboard } as NavEntry] : []),
    { to: '/topics', label: 'Event Topics', icon: Radio },
    { to: '/agents', label: aiEnabled ? 'Agents' : 'Automations', icon: Bot },
    { to: '/capabilities', label: 'Capabilities', icon: Zap },
  ];

  return <SidebarNav heading="Monitor" entries={entries} />;
}
