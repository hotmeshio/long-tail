import { SlidersHorizontal, Play, ListChecks, ScrollText, GitBranch, Cog } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

export function BuildSidebar() {
  const entries: NavEntry[] = [
    {
      kind: 'group',
      label: 'Workflows',
      icon: Cog,
      matchPaths: ['/workflows/registry', '/workflows/start', '/workflows/workers'],
      items: [
        { to: '/workflows/registry', label: 'Configure', icon: SlidersHorizontal },
        { to: '/workflows/start', label: 'Invoke', icon: Play },
      ],
    },
    {
      kind: 'group',
      label: 'Executions',
      icon: ListChecks,
      matchPaths: ['/workflows/executions', '/mcp/executions'],
      items: [
        { to: '/workflows/executions', label: 'Workflows', icon: ScrollText },
        { to: '/mcp/executions', label: 'Pipelines', icon: GitBranch },
      ],
    },
  ];

  return <SidebarNav heading="Build" entries={entries} />;
}
