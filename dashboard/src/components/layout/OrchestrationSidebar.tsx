import { SlidersHorizontal, Play, ListChecks, Code2, Workflow } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';
import { useSettings } from '../../api/settings';
import { getGraphEnabled } from '../../lib/view-as';

/**
 * "Orchestrate" — top-down durable orchestration, authorable two ways.
 * Both flavors are durable and transactional; they differ in form:
 *   Procedural — imperative TypeScript, readable, emulated atop the graph.
 *   Graph      — the compiled DAG, roughly 3x the speed.
 * Each flavor exposes the same shape: Configure, Invoke, Executions.
 *
 * When Graph is hidden (the default) the Procedural group label is dropped —
 * the three items sit directly under "Orchestrate" with no sub-heading.
 * When Graph is enabled both sections are labelled so users can tell them apart.
 */
export function OrchestrationSidebar() {
  const { data: settings } = useSettings();

  // Graph section visibility:
  //   features.graphWorkflows === false → always hidden (easter egg suppressed)
  //   features.graphWorkflows === true  → always shown
  //   absent                           → user opt-in via easter egg (default off)
  const serverGraph = settings?.features?.graphWorkflows;
  const showGraph = serverGraph === true || (serverGraph !== false && getGraphEnabled());

  const proceduralItems = [
    { to: '/workflows/registry', label: 'Registry', icon: SlidersHorizontal },
    { to: '/workflows/durable/invoke', label: 'Invoke', icon: Play },
    { to: '/workflows/executions', label: 'Executions', icon: ListChecks },
  ];

  const entries: NavEntry[] = showGraph
    ? [
        {
          kind: 'group',
          label: 'Procedural',
          icon: Code2,
          matchPaths: [
            '/workflows/registry',
            '/workflows/durable/invoke',
            '/workflows/executions',
            '/workflows/durable/executions',
            '/workflows/start',
            '/workflows/workers',
            '/workflows/tasks',
          ],
          items: proceduralItems,
        },
        {
          kind: 'group',
          label: 'Graph',
          icon: Workflow,
          matchPaths: ['/mcp/workflows', '/mcp/executions'],
          items: [
            // `end` so Configure isn't flagged active on /mcp/workflows/invoke.
            { to: '/mcp/workflows', label: 'Configure', icon: SlidersHorizontal, end: true },
            { to: '/mcp/workflows/invoke', label: 'Invoke', icon: Play },
            { to: '/mcp/executions', label: 'Executions', icon: ListChecks },
          ],
        },
      ]
    : proceduralItems;

  return <SidebarNav heading="Orchestrate" entries={entries} />;
}
