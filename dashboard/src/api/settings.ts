import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

interface AppSettings {
  telemetry: {
    traceUrl: string | null;
  };
}

function fetchSettings(): Promise<AppSettings> {
  return apiFetch<AppSettings>('/settings');
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    staleTime: Infinity,
  });
}
