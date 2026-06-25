export type LTUserStatus = 'active' | 'inactive' | 'suspended';

export type LTRoleType = 'superadmin' | 'admin' | 'member';

/**
 * Work-surface scope axes for an open-role membership. Orthogonal to `type`
 * (which is the management/global tier). `read` governs search breadth, `write`
 * governs claim/ack/delete breadth. Constraint: write ⊆ read (you cannot act on
 * what you cannot see). `self` = escalations assigned to the user; `all` = the
 * whole role queue. `admin`/`superadmin` ignore scope (always act on all).
 */
export type LTReadScope = 'self' | 'all';
export type LTWriteScope = 'none' | 'self' | 'all';

export interface LTUserRole {
  role: string;
  type: LTRoleType;
  read_scope: LTReadScope;
  write_scope: LTWriteScope;
  created_at: Date;
}

export type LTAccountType = 'user' | 'bot';

export interface LTUserRecord {
  id: string;
  external_id: string;
  email: string | null;
  display_name: string | null;
  account_type: LTAccountType;
  status: LTUserStatus;
  metadata: Record<string, any> | null;
  roles: LTUserRole[];
  created_at: Date;
  updated_at: Date;
}
