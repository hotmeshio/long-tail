import {
  Users,
  Database,
  Tag,
  Shield,
  Server,
  Network,
  Braces,
} from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

export function AdminSidebar({ isBuilder = false }: { isBuilder?: boolean }) {
  const identityItems = [
    { to: '/admin/users', label: 'Accounts', icon: Users },
    ...(isBuilder ? [{ to: '/admin/roles', label: 'Roles & Permissions', icon: Tag }] : []),
  ];

  const entries: NavEntry[] = [
    {
      kind: 'group',
      label: 'Identity & Access',
      icon: Shield,
      matchPaths: identityItems.map((i) => i.to),
      items: identityItems,
    },
  ];

  if (isBuilder) {
    entries.push({
      kind: 'group',
      label: 'Infrastructure',
      icon: Server,
      matchPaths: ['/admin/controlplane', '/admin/streams', '/admin/maintenance'],
      items: [
        { to: '/admin/controlplane', label: 'Routers', icon: Network },
        { to: '/admin/streams', label: 'Messages', icon: Braces },
        { to: '/admin/maintenance', label: 'DB Maintenance', icon: Database },
      ],
    });
  }

  return <SidebarNav heading="Admin" entries={entries} />;
}
