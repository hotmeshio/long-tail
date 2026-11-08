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
  /**
   * Wholesale REPLACE of the properties dictionary — for per-key edits use
   * patchUserProperties. Identity bindings absent from the replacement are kept.
   */
  metadata?: Record<string, any>;
}

/**
 * One atomic patch of the user's properties dictionary. Deleting is explicit
 * (`remove`) — a key absent from the patch is kept. `rename` preserves the
 * value. Precedence on collision: set > rename > existing.
 */
export interface UserPropertyOps {
  set?: Record<string, unknown>;
  remove?: string[];
  rename?: Record<string, string>;
}

/** The lt_label_jobs row a recorded property patch writes beside the patch. */
export interface PropertyPatchRecord {
  action: 'bind' | 'reissue';
  requested_by: string;
  /** Patch only an active user; checked in the patch statement. */
  require_active?: boolean;
  /** Which identity keys changed; never their values. */
  source: Record<string, unknown>;
  label_count?: number;
  template_name?: string;
  template_revision?: number;
  template_snapshot?: unknown;
  scheme_version?: number;
  scheme_kind?: string;
  media?: unknown;
  output?: string;
}
