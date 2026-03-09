import {
  Shield,
  Users,
  Link,
  Settings,
  Wrench,
  Tag,
} from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  {
    kind: 'group',
    label: 'RBAC',
    icon: Shield,
    matchPaths: ['/admin/users', '/admin/roles', '/admin/escalation-chains'],
    items: [
      { to: '/admin/users', label: 'Users', icon: Users },
      { to: '/admin/roles', label: 'Roles', icon: Tag },
      { to: '/admin/escalation-chains', label: 'Escalations', icon: Link },
    ],
  },
  { to: '/admin/config', label: 'Workflow Configs', icon: Settings },
  { to: '/admin/maintenance', label: 'Maintenance', icon: Wrench },
];

export function AdminSidebar() {
  return <SidebarNav heading="Admin" headingTo="/admin" entries={entries} />;
}
