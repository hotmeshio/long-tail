import { FolderOpen, Brain } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

const entries: NavEntry[] = [
  { to: '/files', label: 'Files', icon: FolderOpen },
  { to: '/knowledge', label: 'Knowledge', icon: Brain },
];

export function FilesSidebar() {
  return <SidebarNav heading="Storage" entries={entries} />;
}
