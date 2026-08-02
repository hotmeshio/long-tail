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
  IDENTITY_PRIMED: 'identity_primed',
  IDENTITY_UNKNOWN: 'identity_unknown',
  NOT_PRIMED: 'not_primed',
  CHOICES: 'choices',
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
  PRESENT: 'present',
} as const;
export type ScanVerb = (typeof SCAN_VERBS)[keyof typeof SCAN_VERBS];

export const SCAN_SCHEME_KINDS = {
  /** The target resolves against escalations; the rule's steps run. */
  ACTION: 'action',
  /** A badge: the target matches a user and mints a short-lived acting grant. */
  IDENTITY: 'identity',
} as const;
export type ScanSchemeKind = (typeof SCAN_SCHEME_KINDS)[keyof typeof SCAN_SCHEME_KINDS];

export interface ScanScheme {
  version: number;
  name: string;
  description: string | null;
  target_facet: string;
  encoding: 'fixed' | 'delimited';
  delimiter: string;
  target_length: number | null;
  kind: ScanSchemeKind;
  /** Identity kind only: how long a minted acting grant lives (1–86400 s). */
  grant_ttl_seconds: number | null;
  /** Identity kind only: 0 = TTL-bound; n = the grant covers n scan requests. */
  grant_max_uses: number;
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
  params?: ScanStepParams;
  /** PRESENT only: the labeled choice set rendered under the located reality. */
  choices?: ScanChoice[];
  /** PRESENT with one choice: the scan executes it directly instead of presenting. */
  autoSelectSingle?: boolean;
  /** The step executes only under a real acting identity (badge or a write-capable login). */
  requireActingIdentity?: boolean;
}

export interface ScanStepParams {
  resolverPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  targetRole?: string;
  escalationType?: string;
  description?: string;
  closeCurrent?: 'resolve' | 'cancel';
  durationMinutes?: number;
}

/** One labeled choice on a PRESENT step. */
export interface ScanChoice {
  label: string;
  verb: ScanVerb;
  params?: ScanStepParams;
  confirm?: { prompt: string };
  requireActingIdentity?: boolean;
  /** Short token enabling double-scan selection (scan object, then an action card). */
  code?: string;
}

/** One presented choice as the client sees it (CHOICES outcome). */
export interface ScanPresentedChoice {
  index: number;
  label: string;
  verb: ScanVerb;
  confirm?: { prompt: string };
  requireActingIdentity?: boolean;
  code?: string;
  /** True = the identity requirement is unsatisfied; render the notPrimed affordance. */
  withheld: boolean;
}

export interface ScanRuleFallback {
  markdown?: string;
  route?: string;
}

export interface ScanRule {
  scheme_version: number;
  category: string;
  name: string;
  steps: ScanStep[];
  fallback: ScanRuleFallback;
  /** The "scan your badge" screen — shown when an acting identity is required and absent. */
  notPrimed: ScanRuleFallback;
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
  fallback?: ScanRuleFallback;
  /** The "scan your badge" screen (NOT_PRIMED, or beside withheld choices). */
  notPrimed?: ScanRuleFallback;
  /** The labeled choice set (CHOICES). */
  choices?: ScanPresentedChoice[];
  /** CHOICES only: the server would have executed the single choice, but identity stopped it. */
  autoSelect?: boolean;
  /** The badged person (IDENTITY_PRIMED). */
  actor?: { id: string; displayName: string };
  /** The minted acting grant (IDENTITY_PRIMED). */
  actingToken?: string;
  /** Display copy of the grant's expiry (the keystore enforces it). */
  expiresAt?: string;
  error?: string;
}

/** A pointer to a presented choice — the server re-validates everything it references. */
export interface ScanChoiceExecuteRequest {
  schemeVersion: number;
  category: string;
  stepIndex: number;
  choiceIndex: number;
  escalationId: string;
  actingToken?: string;
}

// ── Execute ─────────────────────────────────────────────────────────────────

export function executeScanCode(
  code: string,
  opts?: { actingToken?: string; previousActingToken?: string },
): Promise<ScanExecuteResponse> {
  return apiFetch('/scan-codes/execute', {
    method: 'POST',
    body: JSON.stringify({
      code,
      ...(opts?.actingToken ? { actingToken: opts.actingToken } : {}),
      ...(opts?.previousActingToken ? { previousActingToken: opts.previousActingToken } : {}),
    }),
  });
}

export function executeScanChoice(req: ScanChoiceExecuteRequest): Promise<ScanExecuteResponse> {
  return apiFetch('/scan-codes/execute-choice', {
    method: 'POST',
    body: JSON.stringify(req),
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
