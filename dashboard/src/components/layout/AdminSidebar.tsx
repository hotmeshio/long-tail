import {
  Users,
  Database,
  Drama,
  Inbox,
  Network,
  Braces,
  ScanBarcode,
} from 'lucide-react';
import { SidebarNav, type NavItem } from './SidebarNav';
import { useSettings } from '../../api/settings';
import { getInfrastructureEnabled } from '../../lib/view-as';

/**
 * Admin navigation. "Identity & Access" and "Infrastructure" are top-level
 * categories (no "Admin" umbrella). RBAC is unchanged: Identity & Access shows
 * for any admin (Accounts; Roles only for builders), while Infrastructure is
 * builder-only AND opt-in through the easter-egg Features panel — a powerful
 * set that stays out of the way until a builder asks for it.
 * Operations lives in ChoreographySidebar, not here.
 */
export function AdminSidebar({ isBuilder = false, isOps = false }: { isBuilder?: boolean; isOps?: boolean }) {
  const { data: settings } = useSettings();
  // Default-on: only hide DB Maintenance when the deployment explicitly disables it.
  const showMaintenance = settings?.features?.dbMaintenance !== false;

  const identityItems: NavItem[] = [
    { to: '/admin/users', label: 'Accounts', icon: Users },
    ...(isBuilder || isOps ? [
      { to: '/admin/roles', label: 'Roles', icon: Inbox },
      { to: '/admin/personas', label: 'Personas', icon: Drama },
      { to: '/admin/scan-codes', label: 'Scan Codes', icon: ScanBarcode },
    ] : []),
  ];

  const infraItems: NavItem[] = [
    { to: '/admin/controlplane', label: 'Routers', icon: Network },
    { to: '/admin/streams', label: 'Messages', icon: Braces },
    ...(showMaintenance ? [{ to: '/admin/maintenance', label: 'DB Maintenance', icon: Database }] : []),
  ];

  return (
    <>
      <SidebarNav heading="Identity & Access" entries={identityItems} />
      {isBuilder && getInfrastructureEnabled() && <SidebarNav heading="Infrastructure" entries={infraItems} />}
    </>
  );
}
