import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

/**
 * Per-user preferences — the server-side store for presentation state
 * (pinned views are the first tenant). One cached GET on app mount; PATCH is
 * a shallow top-level merge where null deletes a key.
 */
export interface UserPreferences {
  pinnedViews?: PinnedView[];
  /** Labels of role-provided pins the user has dismissed. */
  hiddenRolePins?: string[];
  [key: string]: unknown;
}

export interface PinnedView {
  id: string;
  label: string;
  /** Dashboard-relative deep link — never data, never authorization. */
  url: string;
  /** Render a live count beside the label (escalations-list URLs only). */
  badge?: boolean;
}

export function usePreferences() {
  return useQuery<{ preferences: UserPreferences }>({
    queryKey: ['me', 'preferences'],
    queryFn: () => apiFetch('/me/preferences'),
    staleTime: 60_000,
  });
}

export function usePatchPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      apiFetch('/me/preferences', { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: (data) => {
      queryClient.setQueryData(['me', 'preferences'], data);
    },
  });
}
