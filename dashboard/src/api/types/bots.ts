export interface BotRecord {
  id: string;
  external_id: string;
  display_name: string | null;
  status: 'active' | 'inactive' | 'suspended';
  account_type: 'bot';
  description: string | null;
  created_by: string | null;
  roles: Array<{ role: string; type: string; created_at: string }>;
  created_at: string;
  updated_at: string;
}

export interface BotApiKeyRecord {
  id: string;
  name: string;
  user_id: string;
  scopes: string[];
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}
