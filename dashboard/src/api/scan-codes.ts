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
  NO_OPEN_CONTAINER: 'no_open_container',
  HELD: 'held',
  REFUSED: 'refused',
  SUBJECT_STALE: 'subject_stale',
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
  ACCUMULATE: 'accumulate',
  PRESENT: 'present',
  HOLD: 'hold',
  FILL: 'fill',
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
  encoding: 'fixed' | 'delimited' | 'gtin';
  delimiter: string;
  target_length: number | null;
  kind: ScanSchemeKind;
  /** Identity kind only: how long a minted acting grant lives (1–86400 s). */
  grant_ttl_seconds: number | null;
  /** Identity kind only: 0 = TTL-bound; n = the grant covers n acts. */
  grant_max_uses: number;
  /** Identity kind only: 'action' spends a use per act; 'subject' binds to one held subject. */
  grant_scope: 'action' | 'subject';
  enabled: boolean;
}

export interface ScanStep {
  query: {
    roles?: string[];
    status?: 'pending' | 'resolved' | 'cancelled';
    availability?: 'available' | 'claimed' | 'mine' | 'any';
    facets?: Record<string, unknown>;
    types?: string[];
    subtypes?: string[];
  };
  cardinality?: 'first' | 'many';
  verb: ScanVerb;
  confirm?: { prompt: string };
  params?: ScanStepParams;
  /** PRESENT only: the labeled choice set rendered under the located reality. */
  choices?: ScanChoice[];
  /** PRESENT only: labeled templates the station states instead of the row's metadata. */
  facts?: { label: string; value: string }[];
  /** PRESENT with one choice: the scan executes it directly instead of presenting. */
  autoSelectSingle?: boolean;
  /** The step executes only under a real acting identity (badge or a write-capable login). */
  requireActingIdentity?: boolean;
  /** The step acts on the held subject and runs only while one from these schemes is held. */
  subject?: { schemes: number[]; claimedByOther?: 'refuse' | 'allow'; facets?: Record<string, string | number | boolean> };
  /** Checked before the write; a miss refuses with nothing written. */
  match?: { target?: string[]; facets?: string[] };
  /** What the station says on a failed match, or a lost race. */
  refuse?: { markdown: string; conflict?: string; missing?: string };
  /** What the station says once the write lands. Markdown template. */
  done?: { markdown: string };
}

export interface ScanStepParams {
  resolverPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  targetRole?: string;
  escalationType?: string;
  description?: string;
  closeCurrent?: 'resolve' | 'cancel';
  durationMinutes?: number;
  /** Item key template (accumulate, container mode). Defaults to `{scan.target}`. */
  itemKey?: string;
  /** Accumulate verb options. */
  accumulate?: {
    /** Item mode: the facet the located item row and its container share. */
    containerFacet?: string;
    /** Expected container queue(s). */
    containerRoles?: string[];
    /** Item mode: also write the item's own row as the reciprocal (default true). */
    reciprocal?: boolean;
    /** Which pending accumulator may be the container. */
    container?: { roles?: string[]; types?: string[]; subtypes?: string[]; facets?: Record<string, unknown> };
    /** The held subject joins the scanned container. */
    from?: 'subject';
    /** The held subject's row collects the scanned code. */
    into?: 'subject';
    /** Into-subject: the scanned code's own pending row, written as the reciprocal. */
    item?: { roles?: string[]; types?: string[]; subtypes?: string[]; facets?: Record<string, unknown> };
  };
  /** Hold verb options. */
  hold?: {
    ttlSeconds?: number;
    label?: string;
    /** Where the item goes, shown largest. Template. */
    headline?: string;
    /** The line under the headline. Template. */
    subline?: string;
    expect?: { schemes: number[]; prompt?: string };
  };
  /** Fill verb options. */
  fill?: { into: 'subject' | 'scanned'; separator?: string; payload?: Record<string, unknown> };
}

/** The station's pointer to the item it is holding. */
export interface ScanSubjectRef {
  code: string;
  escalationId: string;
}

/** A subject as the station shows it. */
export interface ScanHeldSubject extends ScanSubjectRef {
  label: string;
  headline?: string;
  subline?: string;
  expiresAt: string;
  expect?: { schemes: number[]; prompt?: string };
  claimedBy?: { id: string; displayName: string };
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
  parsed?: { version: number; category: string; target: string; raw?: string };
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
  /** CHOICES: the step's curated facts, rendered; absent when the step declares none. */
  facts?: { label: string; value: string }[];
  /** CHOICES only: the server would have executed the single choice, but identity stopped it. */
  autoSelect?: boolean;
  /** NO_OPEN_CONTAINER: the facet the located item names and no pending container carries. */
  container?: { facet: string; value: string };
  /** The badged person (IDENTITY_PRIMED). */
  actor?: { id: string; displayName: string };
  /** The minted acting grant (IDENTITY_PRIMED). */
  actingToken?: string;
  /** Display copy of the grant's expiry (the keystore enforces it). */
  expiresAt?: string;
  /** IDENTITY_PRIMED: the scheme's grant_max_uses; 0 lives to its TTL. */
  maxUses?: number;
  /** IDENTITY_PRIMED: how the grant is spent. */
  grantScope?: 'action' | 'subject';
  /** What happened to the grant this request carried. */
  acting?: { consumed: boolean; remaining: number | null; bound: boolean };
  /** HELD: the subject the station holds now. */
  subject?: ScanHeldSubject;
  /** The station drops its held subject. */
  clearSubject?: boolean;
  /** REFUSED: what to say, and the target(s) the step expected. */
  refusal?: { markdown: string; expected?: string[] };
  /** A fill: how far the batch has come. */
  progress?: { filled: number; total: number; remaining: number };
  /** An executed add that found the item already in place. */
  already?: boolean;
  /** EXECUTED: the step's done copy, rendered. */
  done?: { markdown: string };
  /** NOT_PRIMED that may be replayed once a badge primes. */
  replayable?: boolean;
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
  opts?: { actingToken?: string; previousActingToken?: string; subject?: ScanSubjectRef; stationRole?: string },
): Promise<ScanExecuteResponse> {
  return apiFetch('/scan-codes/execute', {
    method: 'POST',
    body: JSON.stringify({
      code,
      ...(opts?.actingToken ? { actingToken: opts.actingToken } : {}),
      ...(opts?.previousActingToken ? { previousActingToken: opts.previousActingToken } : {}),
      ...(opts?.subject ? { subject: opts.subject } : {}),
      ...(opts?.stationRole ? { stationRole: opts.stationRole } : {}),
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

export function useScanSchemes(opts?: { enabled?: boolean; staleTime?: number }) {
  return useQuery<{ schemes: ScanScheme[] }>({
    queryKey: ['scan-schemes'],
    queryFn: () => apiFetch('/scan-codes/schemes'),
    ...opts,
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
