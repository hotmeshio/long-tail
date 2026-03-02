import {
  LayoutDashboard,
  Shield,
  Users,
  UserCog,
  Link,
  Settings,
  Wrench,
} from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/admin', label: 'Dashboard', end: true, icon: LayoutDashboard },
  {
    kind: 'group',
    label: 'RBAC',
    icon: Shield,
    matchPaths: ['/admin/users', '/admin/user-roles', '/admin/escalation-chains'],
    items: [
      { to: '/admin/users', label: 'Users', icon: Users },
      { to: '/admin/user-roles', label: 'User Roles', icon: UserCog },
      { to: '/admin/escalation-chains', label: 'Escalation Chains', icon: Link },
    ],
  },
  { to: '/admin/config', label: 'Workflow Configs', icon: Settings },
  { to: '/admin/maintenance', label: 'Maintenance', icon: Wrench },
];

export function AdminSidebar() {
  return <SidebarNav heading="Admin" entries={entries} />;
}
