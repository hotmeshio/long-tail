import { SlidersHorizontal, Play, ListChecks, GitBranch, Code2, Workflow } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

/**
 * "Do This Do That" — top-down durable orchestration, authorable two ways.
 * Both flavors are fully durable and transactional; they differ only in form:
 *   Procedural — temporal-like TypeScript, readable, emulated atop the graph.
 *   Graph      — the compiled DAG, ~3x faster, less to read.
 * Each flavor owns its configure/invoke surface and its own execution history.
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
        '/workflows/durable/executions',
        '/workflows/start',
        '/workflows/workers',
        '/workflows/tasks',
      ],
      items: [
        { to: '/workflows/registry', label: 'Configure', icon: SlidersHorizontal },
        { to: '/workflows/durable/invoke', label: 'Invoke', icon: Play },
        { to: '/workflows/durable/executions', label: 'Executions', icon: ListChecks },
      ],
    },
    {
      kind: 'group',
      label: 'Graph',
      icon: Workflow,
      matchPaths: ['/mcp/workflows', '/mcp/executions'],
      items: [
        { to: '/mcp/workflows', label: 'Flows', icon: GitBranch },
        { to: '/mcp/executions', label: 'Executions', icon: ListChecks },
      ],
    },
  ];

  return <SidebarNav heading="Do This Do That" entries={entries} />;
}
