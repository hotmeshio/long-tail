import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

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

export function useNamespaces() {
  return useQuery<{ namespaces: LTNamespace[] }>({
    queryKey: ['namespaces'],
    queryFn: () => apiFetch('/namespaces'),
  });
}
