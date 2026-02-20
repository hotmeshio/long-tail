export type LTUserStatus = 'active' | 'inactive' | 'suspended';

export interface LTUserRole {
  role: string;
  type: string;
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
