import { Zap, Bot, Radio, LayoutDashboard } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';
import type { ViewAsRole } from '../../lib/view-as';

/**
 * "Monitor" — the reactive, event-driven surface (choreography).
 * Builders configure automations, topics, and capabilities here. Operations
 * (COO view) is the first entry for admins and builders.
 *
 * Operators and engineers have no choreography section: their work lives in the
 * Task Queues section (per-lane, rendered by the shell) and the Claimed card on
 * the home page. The old generic "My Queue" / "All" links are retired.
 *
 * `viewAs` overrides the rendered variant when the user is simulating a lower role:
 * - 'engineer' → task queues only (no Monitor)
 * - 'admin'    → shows the Pace Board (same as the isOps branch)
 * - 'operator' → task queues only
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
  // Operator or engineer view: no generic work links — the Task Queues section
  // (shell) and the home Claimed card carry their work.
  if (!isBuilder && (!isOps || viewAs === 'engineer' || viewAs === 'operator')) {
    return null;
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
