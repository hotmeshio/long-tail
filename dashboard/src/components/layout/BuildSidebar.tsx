import { Settings, Play, ListChecks, Wand2, Server, Workflow } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  {
    kind: 'group',
    label: 'Workflows',
    icon: Settings,
    matchPaths: ['/workflows'],
    items: [
      { to: '/workflows/registry', label: 'Registry', icon: Settings },
      { to: '/workflows/start', label: 'Invoke', icon: Play },
      { to: '/workflows/executions', label: 'Executions', icon: ListChecks },
    ],
  },
  {
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
  },
];

export function BuildSidebar() {
  return <SidebarNav heading="Build" entries={entries} />;
}
