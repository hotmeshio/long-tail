export type LTUserStatus = 'active' | 'inactive' | 'suspended';

export type LTRoleType = 'superadmin' | 'admin' | 'member';

export interface LTUserRole {
  role: string;
  type: LTRoleType;
  created_at: Date;
}

export interface LTUserRecord {
  id: string;
  external_id: string;
  email: string | null;
  display_name: string | null;
  status: LTUserStatus;
  metadata: Record<string, any> | null;
  roles: LTUserRole[];
  created_at: Date;
  updated_at: Date;
}
