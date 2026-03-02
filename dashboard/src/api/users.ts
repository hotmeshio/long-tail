import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { LTUserRecord, LTRoleType } from './types';

interface UserListResponse {
  users: LTUserRecord[];
  total: number;
}

interface UserFilters {
  role?: string;
  roleType?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export function useUsers(filters: UserFilters = {}) {
  const params = new URLSearchParams();
  if (filters.role) params.set('role', filters.role);
  if (filters.roleType) params.set('roleType', filters.roleType);
  if (filters.status) params.set('status', filters.status);
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
    }: {
      userId: string;
      role: string;
      type: LTRoleType;
    }) =>
      apiFetch(`/users/${userId}/roles`, {
        method: 'POST',
        body: JSON.stringify({ role, type }),
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
