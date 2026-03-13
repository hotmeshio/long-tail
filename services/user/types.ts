import type { LTRoleType, LTUserStatus } from '../../types';

export const VALID_ROLE_TYPES: LTRoleType[] = ['superadmin', 'admin', 'member'];

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreateUserInput {
  external_id: string;
  email?: string;
  display_name?: string;
  password?: string;
  status?: LTUserStatus;
  metadata?: Record<string, any>;
  roles?: { role: string; type: LTRoleType }[];
}

export interface UpdateUserInput {
  email?: string;
  display_name?: string;
  status?: LTUserStatus;
  metadata?: Record<string, any>;
}
