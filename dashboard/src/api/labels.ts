import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiFetchFile } from './client';
import type { LabelMedia, LabelSheet, LabelSymbology, LabelTone, LabelWarning } from '../../../shared/labels/types';

// ── Types (mirror types/labels on the server) ─────────────────────────────

export interface LabelTemplateCode {
  category: string;
  caption?: string | null;
  tone: LabelTone;
}

export interface LabelTemplate {
  name: string;
  scheme_version: number;
  title: string;
  description: string | null;
  codes: LabelTemplateCode[];
  text: { title?: string; lines?: string[] };
  symbology: LabelSymbology;
  human_readable: boolean;
  media: string | null;
  sensitive: boolean;
  enabled: boolean;
  revision: number;
  source: 'code' | 'api';
}

export type LabelSource =
  | { kind: 'escalations'; ids: string[] }
  | { kind: 'facets'; query: Record<string, unknown> }
  | { kind: 'users'; userIds?: string[]; role?: string }
  | { kind: 'list'; text: string }
  | { kind: 'range'; prefix?: string; from: number; to: number; pad?: number; suffix?: string };

export interface LabelLayout {
  media?: string;
  startPosition?: number;
  copies?: number;
  onePerPage?: boolean;
  cutMarks?: boolean;
}

export type LabelOutput = 'sheet' | 'pdf' | 'zpl' | `transport:${string}`;

export interface LabelJob {
  id: string;
  action: 'print' | 'reissue' | 'bind';
  requested_by: string | null;
  template_name: string | null;
  scheme_kind: string | null;
  sensitive: boolean;
  subject_user_ids: string[] | null;
  targets: string[] | null;
  label_count: number;
  output: string | null;
  created_at: string;
}

export interface LabelPreview {
  template: LabelTemplate;
  sheet: LabelSheet;
  warnings: LabelWarning[];
  labelCount: number;
}

export interface LabelIssueRequest {
  template: string;
  source: LabelSource;
  layout?: LabelLayout;
  output: LabelOutput;
  confirm?: boolean;
}

/** What issuing returned: a sheet to print in the browser, or a file that was downloaded. */
export interface LabelIssued {
  jobId: string;
  sheet?: LabelSheet;
  warnings?: LabelWarning[];
  downloaded?: string;
  receipt?: { accepted: boolean; detail?: string };
}

// ── Queries ───────────────────────────────────────────────────────────────

const TEMPLATES_KEY = ['label-templates'];

export function useLabelTemplates(scheme?: number) {
  return useQuery({
    queryKey: [...TEMPLATES_KEY, scheme ?? 'all'],
    queryFn: () => apiFetch<{ templates: LabelTemplate[] }>(`/labels/templates${scheme ? `?scheme=${scheme}` : ''}`),
  });
}

export function useLabelMedia() {
  return useQuery({
    queryKey: ['label-media'],
    queryFn: () => apiFetch<{ media: LabelMedia[]; defaultMedia: string }>('/labels/media'),
    staleTime: 5 * 60_000,
  });
}

export function useLabelTransports() {
  return useQuery({
    queryKey: ['label-transports'],
    queryFn: () => apiFetch<{ transports: Array<{ name: string; formats: Array<'zpl' | 'pdf'> }> }>('/labels/transports'),
    staleTime: 5 * 60_000,
  });
}

export function useLabelJobs(filters: { template?: string; subjectUserId?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.template) params.set('template', filters.template);
  if (filters.subjectUserId) params.set('subjectUserId', filters.subjectUserId);
  return useQuery({
    queryKey: ['label-jobs', filters],
    queryFn: () => apiFetch<{ jobs: LabelJob[] }>(`/labels/jobs?${params}`),
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────

export function useUpsertLabelTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<LabelTemplate> & { name: string; expected_revision?: number }) =>
      apiFetch<LabelTemplate>(`/labels/templates/${encodeURIComponent(input.name)}`, { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
}

export function useDeleteLabelTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiFetch(`/labels/templates/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
}

export function usePreviewLabels() {
  return useMutation({
    mutationFn: (input: { template: string; source: LabelSource; layout?: LabelLayout }) =>
      apiFetch<LabelPreview>('/labels/preview', { method: 'POST', body: JSON.stringify(input) }),
  });
}

/** Save a downloaded file through a temporary link. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function issue(path: string, body: unknown, output: LabelOutput): Promise<LabelIssued> {
  const init = { method: 'POST', body: JSON.stringify(body) };
  if (output === 'pdf' || output === 'zpl') {
    const { blob, headers } = await apiFetchFile(path, init);
    const jobId = headers.get('X-LT-Label-Job') ?? '';
    const filename = `labels-${jobId}.${output}`;
    saveBlob(blob, filename);
    return { jobId, downloaded: filename };
  }
  const data = await apiFetch<{ job: { id: string }; sheet?: LabelSheet; warnings: LabelWarning[]; receipt?: LabelIssued['receipt'] }>(path, init);
  return { jobId: data.job.id, sheet: data.sheet, warnings: data.warnings, receipt: data.receipt };
}

export function useIssueLabels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LabelIssueRequest) => issue('/labels/issue', input, input.output),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['label-jobs'] }),
  });
}

export function useReissueBadge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; template: string; layout?: LabelLayout; output: LabelOutput }) =>
      issue('/labels/badges/reissue', { ...input, confirm: true }, input.output),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['label-jobs'] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useReprintLabelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; indices?: number[]; output: LabelOutput; layout?: LabelLayout; confirm?: boolean }) =>
      issue(`/labels/jobs/${input.id}/reprint`, input, input.output),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['label-jobs'] }),
  });
}
