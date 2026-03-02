export type LTUserStatus = 'active' | 'inactive' | 'suspended';
export type LTRoleType = 'superadmin' | 'admin' | 'member';

export interface LTUserRole {
  role: string;
  type: LTRoleType;
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
