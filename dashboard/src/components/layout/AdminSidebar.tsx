import {
  Users,
  Wrench,
  Tag,
  Activity,
  Shield,
  Server,
  ScrollText,
} from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  {
    kind: 'group',
    label: 'Identity & Access',
    icon: Shield,
    matchPaths: ['/admin/users', '/admin/roles'],
    items: [
      { to: '/admin/users', label: 'Accounts', icon: Users },
      { to: '/admin/roles', label: 'Roles & Permissions', icon: Tag },
    ],
  },
  {
    kind: 'group',
    label: 'Infrastructure',
    icon: Server,
    matchPaths: ['/admin/controlplane', '/admin/streams', '/admin/maintenance'],
    items: [
      { to: '/admin/controlplane', label: 'Task Queues', icon: Activity },
      { to: '/admin/streams', label: 'Stream Messages', icon: ScrollText },
      { to: '/admin/maintenance', label: 'DB Maintenance', icon: Wrench },
    ],
  },
];

export function AdminSidebar() {
  return <SidebarNav heading="Admin" entries={entries} />;
}
