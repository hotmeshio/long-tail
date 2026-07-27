import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type {
  LTPersonaRecord,
  LTPersonaDetail,
  LTUserPersona,
  LTComposedRoleScope,
} from './types/personas';

export function usePersonas() {
  return useQuery<{ personas: LTPersonaRecord[] }>({
    queryKey: ['personas'],
    queryFn: () => apiFetch('/personas'),
  });
}

export function usePersona(key: string) {
  return useQuery<LTPersonaDetail>({
    queryKey: ['personas', key],
    queryFn: () => apiFetch(`/personas/${encodeURIComponent(key)}`),
    enabled: !!key,
  });
}

export function useCreatePersona() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { key: string; title?: string; description?: string }) =>
      apiFetch('/personas', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] });
    },
  });
}

export function useUpdatePersona() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ...data }: { key: string; title?: string | null; description?: string | null }) =>
      apiFetch(`/personas/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] });
    },
  });
}

export function useDeletePersona() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      apiFetch(`/personas/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] });
      // Deleting a persona removes the memberships it sustained.
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useLinkPersonaRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, role, relationship }: { key: string; role: string; relationship: string }) =>
      apiFetch(`/personas/${encodeURIComponent(key)}/roles/${encodeURIComponent(role)}`, {
        method: 'PUT',
        body: JSON.stringify({ relationship }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });
}

export function useUnlinkPersonaRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, role }: { key: string; role: string }) =>
      apiFetch(`/personas/${encodeURIComponent(key)}/roles/${encodeURIComponent(role)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useAssignPersona() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, key }: { userId: string; key: string }) =>
      apiFetch(`/users/${userId}/personas`, {
        method: 'POST',
        body: JSON.stringify({ persona: key }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useUnassignPersona() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, key }: { userId: string; key: string }) =>
      apiFetch(`/users/${userId}/personas/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useUserPersonas(userId: string | undefined) {
  return useQuery<{ personas: LTUserPersona[]; roles: LTComposedRoleScope[] }>({
    queryKey: ['users', userId, 'personas'],
    queryFn: () => apiFetch(`/users/${userId}/personas`),
    enabled: !!userId,
  });
}
