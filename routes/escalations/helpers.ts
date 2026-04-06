import * as userService from '../../services/user';

/**
 * Return the role names visible to a user, or undefined if superadmin (no filter).
 * Returns an empty array when the user holds no roles at all.
 */
export async function getVisibleRoles(
  userId: string,
): Promise<string[] | undefined> {
  const isSuperAdminUser = await userService.isSuperAdmin(userId);
  if (isSuperAdminUser) return undefined;
  const userRoles = await userService.getUserRoles(userId);
  return userRoles.map((r) => r.role);
}
