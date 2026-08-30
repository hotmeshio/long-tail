import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { LTUserRecord, LTUserRole, LTRoleType, LTReadScope, LTWriteScope } from './types';

interface UserListResponse {
  users: LTUserRecord[];
  total: number;
}

interface UserFilters {
  role?: string;
  roleType?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function useUsers(filters: UserFilters = {}) {
  const params = new URLSearchParams();
  if (filters.role) params.set('role', filters.role);
  if (filters.roleType) params.set('roleType', filters.roleType);
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));

  return useQuery<UserListResponse>({
    queryKey: ['users', filters],
    queryFn: () => apiFetch(`/users?${params}`),
  });
}

export function useUser(id: string) {
  return useQuery<LTUserRecord>({
    queryKey: ['users', id],
    queryFn: () => apiFetch(`/users/${id}`),
    enabled: !!id,
  });
}

/**
 * The signed-in user's role memberships, each with its read/write scope. Sourced
 * from the DB, so it reflects the same scope whatever the login method (password
 * or SSO). Shared cache: the Shell gate and the header menu fetch once.
 */
export function useMyRoles(userId: string | null) {
  return useQuery<LTUserRole[]>({
    queryKey: ['users', userId, 'roles'],
    queryFn: async () => {
      const data = await apiFetch<{ roles: LTUserRole[] }>(`/users/${userId}/roles`);
      return data.roles ?? [];
    },
    enabled: !!userId,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      external_id: string;
      email?: string;
      display_name?: string;
      password?: string;
      roles?: { role: string; type: LTRoleType }[];
    }) =>
      apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      email?: string;
      display_name?: string;
      status?: string;
    }) =>
      apiFetch(`/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

/** One atomic patch of the user's properties dictionary — deleting is explicit, absence means keep. */
export interface UserPropertyOps {
  set?: Record<string, unknown>;
  remove?: string[];
  rename?: Record<string, string>;
}

export function usePatchUserProperties() {
  const queryClient = useQueryClient();
  return useMutation<LTUserRecord, Error, { id: string; ops: UserPropertyOps }>({
    mutationFn: ({ id, ops }) =>
      apiFetch(`/users/${id}/properties`, {
        method: 'PATCH',
        body: JSON.stringify(ops),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

/** The property keys the platform resolves identities against (badge scheme facets). */
export function useSystemPropertyKeys() {
  return useQuery<{ keys: string[] }>({
    queryKey: ['users', 'system-property-keys'],
    queryFn: () => apiFetch('/users/system-property-keys'),
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useAddUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      role,
      type,
      read_scope,
      write_scope,
    }: {
      userId: string;
      role: string;
      type: LTRoleType;
      read_scope?: LTReadScope;
      write_scope?: LTWriteScope;
    }) =>
      apiFetch(`/users/${userId}/roles`, {
        method: 'POST',
        body: JSON.stringify({ role, type, read_scope, write_scope }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useRemoveUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      apiFetch(`/users/${userId}/roles/${encodeURIComponent(role)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
