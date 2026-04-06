import {
  Users,
  Wrench,
  Tag,
  Activity,
} from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/admin/users', label: 'Accounts', icon: Users },
  { to: '/admin/roles', label: 'Roles & Permissions', icon: Tag },
  { to: '/admin/maintenance', label: 'DB Maintenance', icon: Wrench },
  { to: '/admin/controlplane', label: 'Task Queues', icon: Activity },
];

export function AdminSidebar() {
  return <SidebarNav heading="Admin" entries={entries} />;
}
