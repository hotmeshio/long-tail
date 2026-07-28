import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

// ── Types (mirror types/scan-code.ts on the server) ────────────────────────

export const SCAN_OUTCOMES = {
  EXECUTED: 'executed',
  MATCHED_LIST: 'matched_list',
  CONFIRM_REQUIRED: 'confirm_required',
  NO_MATCH_FALLBACK: 'no_match_fallback',
  UNCONFIGURED: 'unconfigured',
  INVALID_CODE: 'invalid_code',
  FORBIDDEN: 'forbidden',
  CONFLICT: 'conflict',
} as const;
export type ScanOutcome = (typeof SCAN_OUTCOMES)[keyof typeof SCAN_OUTCOMES];

export const SCAN_VERBS = {
  SHOW_DETAIL: 'show-detail',
  SHOW_LIST: 'show-list',
  CLAIM: 'claim',
  CLAIM_SHOW_DETAIL: 'claim-show-detail',
  RELEASE: 'release',
  RESOLVE: 'resolve',
  ESCALATE: 'escalate',
  CANCEL: 'cancel',
} as const;
export type ScanVerb = (typeof SCAN_VERBS)[keyof typeof SCAN_VERBS];

export interface ScanScheme {
  version: number;
  name: string;
  description: string | null;
  target_facet: string;
  encoding: 'fixed' | 'delimited';
  delimiter: string;
  target_length: number | null;
  enabled: boolean;
}

export interface ScanStep {
  query: {
    roles?: string[];
    status?: 'pending' | 'resolved' | 'cancelled';
    availability?: 'available' | 'claimed' | 'mine' | 'any';
    facets?: Record<string, unknown>;
  };
  cardinality?: 'first' | 'many';
  verb: ScanVerb;
  confirm?: { prompt: string };
  params?: {
    resolverPayload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    targetRole?: string;
    escalationType?: string;
    description?: string;
    closeCurrent?: 'resolve' | 'cancel';
    durationMinutes?: number;
  };
}

export interface ScanRule {
  scheme_version: number;
  category: string;
  name: string;
  steps: ScanStep[];
  fallback: { markdown?: string; route?: string };
  enabled: boolean;
}

export interface ScanPendingAction {
  escalationId: string;
  verb: ScanVerb;
  prompt: string;
  params?: ScanStep['params'];
}

export interface ScanExecuteResponse {
  outcome: ScanOutcome;
  parsed?: { version: number; category: string; target: string };
  rule?: { schemeVersion: number; category: string; name: string };
  stepIndex?: number;
  verb?: ScanVerb;
  escalation?: { id: string; role: string; status: string } & Record<string, unknown>;
  escalations?: Record<string, unknown>[];
  total?: number;
  listQuery?: Record<string, unknown> & { targetFacet: string; target: string };
  pendingAction?: ScanPendingAction;
  fallback?: { markdown?: string; route?: string };
  error?: string;
}

// ── Execute ─────────────────────────────────────────────────────────────────

export function executeScanCode(code: string): Promise<ScanExecuteResponse> {
  return apiFetch('/scan-codes/execute', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

// ── Scheme / rule config ────────────────────────────────────────────────────

export function useScanSchemes() {
  return useQuery<{ schemes: ScanScheme[] }>({
    queryKey: ['scan-schemes'],
    queryFn: () => apiFetch('/scan-codes/schemes'),
  });
}

export function useScanScheme(version: number | null) {
  return useQuery<{ scheme: ScanScheme; rules: ScanRule[] }>({
    queryKey: ['scan-schemes', version],
    queryFn: () => apiFetch(`/scan-codes/schemes/${version}`),
    enabled: version != null,
  });
}

export function useUpsertScanScheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scheme: Partial<ScanScheme> & { version: number }) =>
      apiFetch(`/scan-codes/schemes/${scheme.version}`, {
        method: 'PUT',
        body: JSON.stringify(scheme),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scan-schemes'] }),
  });
}

export function useDeleteScanScheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: number) =>
      apiFetch(`/scan-codes/schemes/${version}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scan-schemes'] }),
  });
}

export function useUpsertScanRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rule: Partial<ScanRule> & { scheme_version: number; category: string }) =>
      apiFetch(`/scan-codes/schemes/${rule.scheme_version}/actions/${rule.category}`, {
        method: 'PUT',
        body: JSON.stringify(rule),
      }),
    onSuccess: (_d, rule) =>
      qc.invalidateQueries({ queryKey: ['scan-schemes', rule.scheme_version] }),
  });
}

export function useDeleteScanRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { scheme_version: number; category: string }) =>
      apiFetch(`/scan-codes/schemes/${input.scheme_version}/actions/${input.category}`, {
        method: 'DELETE',
      }),
    onSuccess: (_d, input) =>
      qc.invalidateQueries({ queryKey: ['scan-schemes', input.scheme_version] }),
  });
}
