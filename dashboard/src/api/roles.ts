import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface EscalationChain {
  source_role: string;
  target_role: string;
}

export interface RoleDetail {
  role: string;
  title: string | null;
  description: string | null;
  form_schema: Record<string, unknown> | null;
  metadata_schema: Record<string, unknown> | null;
  properties: Record<string, unknown>;
  ops_visible: boolean;
  parent_role: string | null;
  sla_minutes: number | null;
  target_per_hour: number | null;
  worker_count: number | null;
  /** Version of the live schema pair; each schema edit advances it. Null until the role first carries a schema. */
  current_schema_version: number | null;
  user_count: number;
  chain_count: number;
  workflow_count: number;
}

/** One immutable snapshot of a role's schema pair. */
export interface RoleSchemaVersion {
  role: string;
  version: number | null;
  form_schema: Record<string, unknown> | null;
  metadata_schema: Record<string, unknown> | null;
  change_summary: string | null;
  created_at: string | null;
  latest_version: number | null;
}

/** Version-history row (schemas elided; presence flags only). */
export interface RoleSchemaVersionSummary {
  version: number;
  has_form_schema: boolean;
  has_metadata_schema: boolean;
  change_summary: string | null;
  created_at: string;
  is_current: boolean;
}

export interface UpdateRoleInput {
  title?: string | null;
  description?: string | null;
  form_schema?: Record<string, unknown> | null;
  metadata_schema?: Record<string, unknown> | null;
  properties?: Record<string, unknown> | null;
  ops_visible?: boolean;
  parent_role?: string | null;
  sla_minutes?: number | null;
  target_per_hour?: number | null;
  worker_count?: number | null;
  /** Recorded on the schema version snapshot when the update changes a schema field. */
  change_summary?: string;
}

export function useRoles() {
  return useQuery<{ roles: string[] }>({
    queryKey: ['roles'],
    queryFn: () => apiFetch('/roles'),
  });
}

export function useEscalationChains() {
  return useQuery<{ chains: EscalationChain[] }>({
    queryKey: ['roles', 'escalation-chains'],
    queryFn: () => apiFetch('/roles/escalation-chains'),
  });
}

export function useEscalationTargets(role: string) {
  return useQuery<{ targets: string[] }>({
    queryKey: ['roles', role, 'escalation-targets'],
    queryFn: () => apiFetch(`/roles/${encodeURIComponent(role)}/escalation-targets`),
    enabled: !!role,
  });
}

export function useUpdateEscalationTargets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ role, targets }: { role: string; targets: string[] }) =>
      apiFetch(`/roles/${encodeURIComponent(role)}/escalation-targets`, {
        method: 'PUT',
        body: JSON.stringify({ targets }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });
}

export function useAddEscalationChain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chain: EscalationChain) =>
      apiFetch('/roles/escalation-chains', {
        method: 'POST',
        body: JSON.stringify(chain),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });
}

export function useRemoveEscalationChain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chain: EscalationChain) =>
      apiFetch('/roles/escalation-chains', {
        method: 'DELETE',
        body: JSON.stringify(chain),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });
}

export function useRoleDetails() {
  return useQuery<{ roles: RoleDetail[] }>({
    queryKey: ['roles', 'details'],
    queryFn: () => apiFetch('/roles/details'),
  });
}

/**
 * Fetch a role's schema pair. A version pins the immutable snapshot an
 * escalation was created against (metadata.schema_version); omitted, the live
 * (latest) schema is returned with its current version number.
 */
export function useRoleSchema(role: string, version?: number, enabled = true) {
  return useQuery<RoleSchemaVersion>({
    queryKey: ['roles', role, 'schema', version ?? 'latest'],
    queryFn: () =>
      apiFetch(`/roles/${encodeURIComponent(role)}/schema${version != null ? `?version=${version}` : ''}`),
    enabled: enabled && !!role,
  });
}

export function useRoleSchemaVersions(role: string) {
  return useQuery<{ versions: RoleSchemaVersionSummary[] }>({
    queryKey: ['roles', role, 'schema-versions'],
    queryFn: () => apiFetch(`/roles/${encodeURIComponent(role)}/schema/versions`),
    enabled: !!role,
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (role: string) =>
      apiFetch('/roles', {
        method: 'POST',
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ role, ...input }: { role: string } & UpdateRoleInput) =>
      apiFetch(`/roles/${encodeURIComponent(role)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (role: string) =>
      apiFetch(`/roles/${encodeURIComponent(role)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });
}
