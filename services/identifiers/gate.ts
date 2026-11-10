import { mayManageRoles, type CapabilityPrincipal } from '../../modules/capabilities';
import { hasRole } from '../user/roles';
import type { ScanScheme } from '../../types';

/** Binding and retiring take a role manager, or a role the scheme names as a binder. */
export async function mayBind(principal: CapabilityPrincipal | undefined, scheme: Pick<ScanScheme, 'identifier'>): Promise<boolean> {
  if (!principal?.userId) return false;
  if (await mayManageRoles(principal)) return true;
  const binders = scheme.identifier?.binders ?? [];
  for (const role of binders) if (await hasRole(principal.userId, role)) return true;
  return false;
}
