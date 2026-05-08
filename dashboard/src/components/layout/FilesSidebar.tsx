import { FolderOpen } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/files', label: 'Files', icon: FolderOpen },
];

export function FilesSidebar() {
  return <SidebarNav heading="Storage" entries={entries} />;
}
