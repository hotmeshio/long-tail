import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface FileEntry {
  path: string;
  size: number;
  modified_at: string;
}

export interface BrowseResponse {
  files: FileEntry[];
  directories: string[];
  nextToken?: string;
}

export interface FileMetadata {
  path: string;
  size: number;
  modified_at: string;
  content_type: string;
}

export interface SignedUrlResponse {
  url: string;
  expiresAt: string;
}

export function useFileBrowse(prefix: string, pageSize = 100, continuationToken?: string) {
  const params = new URLSearchParams();
  if (prefix) params.set('prefix', prefix);
  params.set('pageSize', String(pageSize));
  if (continuationToken) params.set('continuationToken', continuationToken);
  const qs = params.toString();

  return useQuery<BrowseResponse>({
    queryKey: ['fileBrowse', prefix, pageSize, continuationToken],
    queryFn: () => apiFetch(`/file-browser/browse?${qs}`),
  });
}

export function useFileMetadata(filePath: string | null) {
  return useQuery<FileMetadata>({
    queryKey: ['fileMetadata', filePath],
    queryFn: () => apiFetch(`/file-browser/metadata/${filePath}`),
    enabled: !!filePath,
  });
}

export function useGenerateSignedUrl() {
  return useMutation<SignedUrlResponse, Error, { path: string; expiresIn: number }>({
    mutationFn: (data) =>
      apiFetch('/file-browser/signed-url', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}

export function useDeleteFile() {
  return useMutation<{ deleted: boolean; path: string }, Error, string>({
    mutationFn: (filePath) =>
      apiFetch(`/file-browser/delete/${filePath}`, { method: 'DELETE' }),
  });
}

export function useUploadFile() {
  return useMutation<{ path: string; size: number; content_type: string }, Error, { path: string; file: File }>({
    mutationFn: async ({ path, file }) => {
      const buffer = await file.arrayBuffer();
      // Always send as octet-stream to bypass Express JSON body parser
      return apiFetch(`/file-browser/upload?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer,
      });
    },
  });
}

export function useFilePreviewUrl(filePath: string | null) {
  return useQuery<string>({
    queryKey: ['filePreviewUrl', filePath],
    queryFn: async () => {
      const result = await apiFetch<SignedUrlResponse>('/file-browser/signed-url', {
        method: 'POST',
        body: JSON.stringify({ path: filePath, expiresIn: 3600 }),
      });
      return result.url;
    },
    enabled: !!filePath,
    staleTime: 50 * 60 * 1000, // cache for 50 min (token valid for 60)
  });
}

/** @deprecated Use useFilePreviewUrl() for signed access */
export function getFilePreviewUrl(filePath: string): string {
  return `/api/files/${filePath.replace(/^\/+/, '')}`;
}

export function getFileDownloadUrl(filePath: string): string {
  return `/api/file-browser/download/${filePath.replace(/^\/+/, '')}`;
}
