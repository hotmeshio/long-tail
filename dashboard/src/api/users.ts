import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { LTUserRecord, LTUserRole, LTRoleType, LTReadScope, LTWriteScope } from './types';

/** Identity is stable and every user mutation invalidates ['users']; hold it for minutes and never refetch on window focus — a name resolves once across a list, not per row or per tab focus. */
export const USER_QUERY_OPTIONS = { staleTime: 5 * 60_000, refetchOnWindowFocus: false } as const;

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

export function useUsers(filters: UserFilters = {}, options: { enabled?: boolean } = {}) {
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
    enabled: options.enabled ?? true,
    ...USER_QUERY_OPTIONS,
  });
}

/** The fat record — the admin user-management pages. UI that only needs a name uses useUserName. */
export function useUser(id: string) {
  return useQuery<LTUserRecord>({
    queryKey: ['users', id],
    queryFn: () => apiFetch(`/users/${id}`),
    enabled: !!id,
    ...USER_QUERY_OPTIONS,
  });
}

export interface UserNameRecord {
  id: string;
  display_name: string | null;
  external_id: string;
  email: string | null;
}

const NAME_BATCH_MAX = 200;

async function fetchUserNames(ids: string[]): Promise<UserNameRecord[]> {
  const out: UserNameRecord[] = [];
  for (let i = 0; i < ids.length; i += NAME_BATCH_MAX) {
    const res = await apiFetch<{ users: UserNameRecord[] }>('/users/names', {
      method: 'POST',
      body: JSON.stringify({ ids: ids.slice(i, i + NAME_BATCH_MAX) }),
    });
    out.push(...(res.users ?? []));
  }
  return out;
}

let nameBatch: string[] = [];
let namePending = new Map<string, { resolve: (v: UserNameRecord | null) => void; reject: (e: unknown) => void }>();
let nameScheduled = false;

function flushNameBatch() {
  const ids = nameBatch;
  const pending = namePending;
  nameBatch = [];
  namePending = new Map();
  nameScheduled = false;
  fetchUserNames(ids)
    .then((recs) => {
      const byId = new Map(recs.map((r) => [r.id, r]));
      for (const [id, p] of pending) p.resolve(byId.get(id) ?? null);
    })
    .catch((err) => { for (const p of pending.values()) p.reject(err); });
}

/**
 * Coalesce every name lookup fired in one tick into a single POST /users/names.
 * React Query de-dupes the per-id query, so each distinct id enters the batch
 * once; a whole list or timeline resolves its people in one request.
 */
function loadUserName(id: string): Promise<UserNameRecord | null> {
  return new Promise((resolve, reject) => {
    nameBatch.push(id);
    namePending.set(id, { resolve, reject });
    if (!nameScheduled) {
      nameScheduled = true;
      setTimeout(flushNameBatch, 0);
    }
  });
}

/** Resolve one user id to display fields, batched and cached by id. The thin path behind UserName. */
export function useUserName(id: string) {
  return useQuery<UserNameRecord | null>({
    queryKey: ['user-name', id],
    queryFn: () => loadUserName(id),
    enabled: !!id,
    ...USER_QUERY_OPTIONS,
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
    ...USER_QUERY_OPTIONS,
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
