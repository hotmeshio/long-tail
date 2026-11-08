export { CreateUserInput, PropertyPatchRecord, UpdateUserInput, UserPropertyOps, VALID_ROLE_TYPES } from './types';
export { redactIdentityKeys, setIdentityKeyProtection, identityKeysProtected } from './redact';
export {
  createUser,
  getUser,
  getUserNames,
  UserNameRecord,
  getUserByExternalId,
  getUserByEmail,
  getUserByMetadataValue,
  updateUser,
  patchUserProperties,
  patchUserPropertiesRecorded,
  identityKeysTouched,
  getIdentityPropertyKeys,
  UserPropertyConflictError,
  UserPropertyValidationError,
  deleteUser,
  listUsers,
} from './crud';
export {
  isValidRoleType,
  addUserRole,
  grantRoleIfAbsent,
  removeUserRole,
  getUserRoles,
  hasRole,
  hasRoleType,
} from './roles';
export { isSuperAdmin, isGroupAdmin, canManageRole, hasGlobalEscalationAccess, hasRolesAsAdmin, getRoleScope, getRoleWriteScope } from './rbac';
export {
  READ_SCOPES,
  WRITE_SCOPES,
  DEFAULT_READ_SCOPE,
  DEFAULT_WRITE_SCOPE,
  isValidReadScope,
  isValidWriteScope,
  isValidScopePair,
  effectiveScope,
} from './scope';
export { verifyPassword } from './auth';
export { seedAdmin } from './seed-admin';
export { getPreferences, patchPreferences, PREFERENCES_MAX_BYTES } from './preferences';
