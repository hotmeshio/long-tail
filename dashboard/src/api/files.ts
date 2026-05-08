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

export function getFilePreviewUrl(filePath: string): string {
  return `/api/files/${filePath.replace(/^\/+/, '')}`;
}

export function getFileDownloadUrl(filePath: string): string {
  return `/api/file-browser/download/${filePath.replace(/^\/+/, '')}`;
}
