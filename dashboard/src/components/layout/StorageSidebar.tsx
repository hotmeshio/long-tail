import { FolderOpen, Braces } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/files', label: 'Files', icon: FolderOpen },
  { to: '/knowledge', label: 'Knowledge Base', icon: Braces },
];

export function StorageSidebar() {
  return <SidebarNav heading="Storage" entries={entries} />;
}
