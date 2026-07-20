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
  /** Max age (minutes) before a pending unclaimed item counts as priority on the Pace Board. Falls back to sla_minutes. */
  priority_threshold_minutes: number | null;
  /** Escalation metadata key holding the age origin (ISO 8601 UTC timestamp). Falls back to created_at. */
  priority_facet: string | null;
  /** Version of the live schema pair; each schema edit advances it. Null until the role first carries a schema. */
  current_schema_version: number | null;
  /** Rich formatting for this role's escalation list page (x-lt-* markup). Opt-in; versioned independently. */
  list_schema: Record<string, unknown> | null;
  /** Version of the live list_schema; advances only on list-schema edits. Null until the role first carries one. */
  current_list_schema_version: number | null;
  /** Pinned-view seeds for members: [{ label, url, badge? }]. Users promote/hide/reorder via preferences. */
  default_pins: { label: string; url: string; badge?: boolean }[] | null;
  /**
   * Roles this station draws input from that live in other sequences.
   * parent_role is the single prior step placing the role in one sequence;
   * these are the remaining graph edges, shown as a merge affordance on the
   * Operations chart.
   */
  upstream_roles: string[];
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

/** One immutable snapshot of a role's list schema (independent version lineage). */
export interface RoleListSchemaVersion {
  role: string;
  version: number | null;
  list_schema: Record<string, unknown> | null;
  change_summary: string | null;
  created_at: string | null;
  latest_version: number | null;
}

/** List-schema version-history row (schema elided). */
export interface RoleListSchemaVersionSummary {
  version: number;
  has_list_schema: boolean;
  change_summary: string | null;
  created_at: string;
  is_current: boolean;
}

export interface UpdateRoleInput {
  title?: string | null;
  description?: string | null;
  form_schema?: Record<string, unknown> | null;
  metadata_schema?: Record<string, unknown> | null;
  list_schema?: Record<string, unknown> | null;
  default_pins?: { label: string; url: string; badge?: boolean }[] | null;
  properties?: Record<string, unknown> | null;
  ops_visible?: boolean;
  parent_role?: string | null;
  sla_minutes?: number | null;
  target_per_hour?: number | null;
  worker_count?: number | null;
  priority_threshold_minutes?: number | null;
  priority_facet?: string | null;
  /** Replace the upstream-input set (omitted = preserve; [] = clear). */
  upstream_roles?: string[];
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

export function useRoleDetails(opts?: { enabled?: boolean }) {
  return useQuery<{ roles: RoleDetail[] }>({
    queryKey: ['roles', 'details'],
    queryFn: () => apiFetch('/roles/details'),
    enabled: opts?.enabled ?? true,
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

/**
 * Fetch a role's LIST schema (rich list-page formatting). A version pins the
 * immutable snapshot; omitted, the live (latest) list schema is returned.
 * Versions independently of the resolve form schema.
 */
export function useRoleListSchema(role: string, version?: number, enabled = true) {
  return useQuery<RoleListSchemaVersion>({
    queryKey: ['roles', role, 'list-schema', version ?? 'latest'],
    queryFn: () =>
      apiFetch(`/roles/${encodeURIComponent(role)}/list-schema${version != null ? `?version=${version}` : ''}`),
    enabled: enabled && !!role,
  });
}

export function useRoleListSchemaVersions(role: string) {
  return useQuery<{ versions: RoleListSchemaVersionSummary[] }>({
    queryKey: ['roles', role, 'list-schema-versions'],
    queryFn: () => apiFetch(`/roles/${encodeURIComponent(role)}/list-schema/versions`),
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
    onMutate: async ({ role, ...input }) => {
      await queryClient.cancelQueries({ queryKey: ['roles', 'details'] });
      const previous = queryClient.getQueryData<{ roles: RoleDetail[] }>(['roles', 'details']);
      if (previous) {
        queryClient.setQueryData<{ roles: RoleDetail[] }>(['roles', 'details'], {
          roles: previous.roles.map((r) =>
            r.role === role ? { ...r, ...(input as Partial<RoleDetail>) } : r,
          ),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['roles', 'details'], context.previous);
      }
    },
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
