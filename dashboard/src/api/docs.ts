import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

interface DocEntry {
  path: string;
  title: string;
}

interface DocContent {
  path: string;
  content: string;
}

export function useDocList() {
  return useQuery<{ docs: DocEntry[] }>({
    queryKey: ['docs'],
    queryFn: () => apiFetch('/docs'),
    staleTime: 5 * 60_000,
  });
}

export function useDocContent(docPath: string | null) {
  return useQuery<DocContent>({
    queryKey: ['docs', docPath],
    queryFn: () => apiFetch(`/docs/read?path=${encodeURIComponent(docPath!)}`),
    enabled: !!docPath,
    staleTime: 5 * 60_000,
  });
}
