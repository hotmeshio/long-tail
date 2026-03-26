/** Type definitions for the namespace service. */

export interface LTNamespace {
  id: string;
  name: string;
  description: string | null;
  schema_name: string;
  is_default: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
