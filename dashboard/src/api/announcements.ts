import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { NATS_SUBJECT_PREFIX } from '../lib/nats/config';

/**
 * The dashboard-surface broadcast topic — the server publishes announcement
 * events with this type.
 */
export const ANNOUNCEMENT_TOPIC = 'system.surfaces.dashboard';

/**
 * The wire subject the banner subscribes to. Events travel as
 * `lt.events.{type}`, so subscription patterns carry the prefix — a bare
 * topic never matches.
 */
export const ANNOUNCEMENT_SUBJECT = `${NATS_SUBJECT_PREFIX}.${ANNOUNCEMENT_TOPIC}`;

export interface Announcement {
  id: string;
  title: string | null;
  /** Markdown. */
  body: string;
  layout: string;
  /** Empty = everyone; otherwise display-scoped to holders of any named role. */
  roles: string[];
  created_by: string | null;
  created_at: string;
  expires_at: string;
}

/** Active announcements for the signed-in user (server-filtered to their roles). */
export function useAnnouncements(enabled = true) {
  return useQuery({
    queryKey: ['announcements'],
    queryFn: () => apiFetch<{ announcements: Announcement[] }>('/announcements'),
    enabled,
    staleTime: 30_000,
  });
}

/** Publish an announcement (role managers). Expiry arrives precomputed. */
export function useCreateAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; title?: string; roles?: string[]; expiresAt?: string }) =>
      apiFetch<Announcement>('/announcements', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
    },
  });
}

/** Remove an announcement; subscribers see it drop live. */
export function useDeleteAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ deleted: boolean; id: string }>(`/announcements/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
    },
  });
}
