import {
  Users,
  Wrench,
  Tag,
} from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/roles', label: 'Roles', icon: Tag },
  { to: '/admin/maintenance', label: 'DB Maintenance', icon: Wrench },
];

export function AdminSidebar() {
  return <SidebarNav heading="Admin" headingTo="/admin" entries={entries} />;
}
