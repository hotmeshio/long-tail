import { Settings, Play, ListChecks, Wand2, Server, Workflow } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

export function BuildSidebar({ aiEnabled = false }: { aiEnabled?: boolean }) {
  const workflowItems = [
    { to: '/workflows/registry', label: 'Registry', icon: Settings },
    { to: '/workflows/start', label: 'Invoke', icon: Play },
  ];

  // Workflow Executions is a sub-item only when AI is enabled
  // (otherwise it lives in the standalone Executions group below)
  if (aiEnabled) {
    workflowItems.push({ to: '/workflows/executions', label: 'Executions', icon: ListChecks });
  }

  const entries: NavEntry[] = [
    {
      kind: 'group',
      label: 'Workflows',
      icon: Settings,
      matchPaths: ['/workflows'],
      items: workflowItems,
    },
  ];

  if (aiEnabled) {
    entries.push({
      kind: 'group',
      label: 'Pipelines',
      icon: Workflow,
      matchPaths: ['/mcp'],
      items: [
        { to: '/mcp/queries', label: 'Designer', icon: Wand2 },
        { to: '/mcp/servers', label: 'Servers & Tools', icon: Server },
        { to: '/mcp/workflows', label: 'Pipeline Tools', icon: Workflow },
        { to: '/mcp/executions', label: 'Executions', icon: ListChecks },
      ],
    });
  } else {
    entries.push({
      kind: 'group',
      label: 'Executions',
      icon: ListChecks,
      matchPaths: ['/mcp', '/workflows/executions'],
      items: [
        { to: '/workflows/executions', label: 'Workflows', icon: Settings },
        { to: '/mcp/executions', label: 'Pipelines', icon: Workflow },
      ],
    });
  }

  return <SidebarNav heading="Build" entries={entries} />;
}
