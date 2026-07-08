import { SlidersHorizontal, Play, ListChecks, Code2, Workflow } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

/**
 * "Orchestrate" — top-down durable orchestration, authorable two ways.
 * Both flavors are durable and transactional; they differ in form:
 *   Procedural — imperative TypeScript, readable, emulated atop the graph.
 *   Graph      — the compiled DAG, roughly 3x the speed.
 * Each flavor exposes the same shape: Configure, Invoke, Executions.
 */
export function OrchestrationSidebar() {
  const entries: NavEntry[] = [
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
      items: [
        { to: '/workflows/registry', label: 'Registry', icon: SlidersHorizontal },
        { to: '/workflows/durable/invoke', label: 'Invoke', icon: Play },
        { to: '/workflows/executions', label: 'Executions', icon: ListChecks },
      ],
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
  ];

  return <SidebarNav heading="Orchestrate" entries={entries} />;
}
