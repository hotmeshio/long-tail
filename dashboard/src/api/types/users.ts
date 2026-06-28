export type LTUserStatus = 'active' | 'inactive' | 'suspended';
export type LTRoleType = 'superadmin' | 'admin' | 'member';

/** Work-surface scope axes for a member: read = search breadth, write = act breadth. */
export type LTReadScope = 'self' | 'all';
export type LTWriteScope = 'none' | 'self' | 'all';

export interface LTUserRole {
  role: string;
  type: LTRoleType;
  read_scope: LTReadScope;
  write_scope: LTWriteScope;
  created_at: string;
}

export interface LTUserRecord {
  id: string;
  external_id: string;
  email: string | null;
  display_name: string | null;
  status: LTUserStatus;
  metadata: Record<string, unknown> | null;
  roles: LTUserRole[];
  created_at: string;
  updated_at: string;
}
