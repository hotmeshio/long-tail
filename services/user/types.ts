import type { LTReadScope, LTRoleType, LTUserStatus, LTWriteScope } from '../../types';

export const VALID_ROLE_TYPES: LTRoleType[] = ['superadmin', 'admin', 'member'];

/** A role grant on user create: management tier + optional work-surface scope. */
export interface RoleGrantInput {
  role: string;
  type: LTRoleType;
  read_scope?: LTReadScope;
  write_scope?: LTWriteScope;
}

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreateUserInput {
  external_id: string;
  email?: string;
  display_name?: string;
  password?: string;
  status?: LTUserStatus;
  metadata?: Record<string, any>;
  roles?: RoleGrantInput[];
  /** OAuth identity link (set during OAuth auto-provisioning). */
  oauth_provider?: string;
  oauth_provider_id?: string;
}

export interface UpdateUserInput {
  email?: string;
  display_name?: string;
  password?: string;
  status?: LTUserStatus;
  metadata?: Record<string, any>;
}
