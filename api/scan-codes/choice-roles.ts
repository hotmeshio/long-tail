import * as userService from '../../services/user';
import { holdsActionRole } from '../../shared/form-validation/x-lt-actions';
import type { ScanChoice } from '../../types';

/** True when the person may run the choice: it names no roles, or they hold one (superadmin always). */
export async function holdsChoiceRole(choice: Pick<ScanChoice, 'roles'>, userId: string): Promise<boolean> {
  if (!choice.roles?.length) return true;
  const [roles, superadmin] = await Promise.all([
    userService.getUserRoles(userId),
    userService.isSuperAdmin(userId),
  ]);
  return holdsActionRole(choice, roles.map((r) => r.role), superadmin);
}
