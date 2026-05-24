import { forwardRef } from 'react';
import {
  Users,
  Database,
  Tag,
  Cylinder,
  Shield,
  Server,
  Rows3,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const QueueIcon = forwardRef<SVGSVGElement, LucideProps>((props, ref) => (
  <Cylinder ref={ref} {...props} style={{ ...props.style, transform: 'rotate(90deg)' }} />
));
QueueIcon.displayName = 'QueueIcon';

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
      { to: '/admin/controlplane', label: 'Queues', icon: QueueIcon },
      { to: '/admin/streams', label: 'Messages', icon: Rows3 },
      { to: '/admin/maintenance', label: 'DB Maintenance', icon: Database },
    ],
  },
];

export function AdminSidebar() {
  return <SidebarNav heading="Admin" entries={entries} />;
}
