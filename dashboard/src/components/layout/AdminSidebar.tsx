import {
  Users,
  Database,
  Tag,
  Network,
  Braces,
  LayoutDashboard,
} from 'lucide-react';
import { SidebarNav, type NavItem } from './SidebarNav';
import { useSettings } from '../../api/settings';
import { useAccess } from '../../hooks/useAccess';

/**
 * Admin navigation. "Identity & Access" and "Infrastructure" are top-level
 * categories (no "Admin" umbrella). RBAC is unchanged: Identity & Access shows
 * for any admin (Accounts; Roles only for builders), while Infrastructure is
 * builder-only — so an admin who could see Identity & Access but not
 * Infrastructure still sees exactly that.
 */
export function AdminSidebar({ isBuilder = false }: { isBuilder?: boolean }) {
  const { data: settings } = useSettings();
  const { isOps } = useAccess();
  // Default-on: only hide DB Maintenance when the deployment explicitly disables it.
  const showMaintenance = settings?.features?.dbMaintenance !== false;

  const identityItems: NavItem[] = [
    { to: '/admin/users', label: 'Accounts', icon: Users },
    ...(isBuilder ? [{ to: '/admin/roles', label: 'Roles', icon: Tag }] : []),
  ];

  const infraItems: NavItem[] = [
    { to: '/admin/controlplane', label: 'Routers', icon: Network },
    { to: '/admin/streams', label: 'Messages', icon: Braces },
    ...(showMaintenance ? [{ to: '/admin/maintenance', label: 'DB Maintenance', icon: Database }] : []),
  ];

  const opsItems: NavItem[] = [
    { to: '/operations', label: 'Operations', icon: LayoutDashboard },
  ];

  return (
    <>
      {(isOps || isBuilder) && <SidebarNav heading="Operations" entries={opsItems} />}
      <SidebarNav heading="Identity & Access" entries={identityItems} />
      {isBuilder && <SidebarNav heading="Infrastructure" entries={infraItems} />}
    </>
  );
}
