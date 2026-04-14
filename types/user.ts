export type LTUserStatus = 'active' | 'inactive' | 'suspended';

export type LTRoleType = 'superadmin' | 'admin' | 'member';

export interface LTUserRole {
  role: string;
  type: LTRoleType;
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
