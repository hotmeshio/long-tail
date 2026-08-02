/**
 * Scan-code types: schemes, rules, and execute outcomes.
 *
 * A scan code is a plain string from any input source (barcode scanner,
 * RFID reader, manual entry) encoding version:category:target. The scheme
 * (selected by the leading TWO digits, 10-99) declares which escalation
 * metadata facet the target resolves against and how the string parses.
 * The rule (selected by the single-digit category, 0-9) is an ordered list
 * of condition/action steps over the escalation surface plus a fallback.
 * Both indices are assigned automatically; operators name entries, not numbers.
 */

import type { ScanChoice, ScanPresentedChoice } from './scan-choice';

export const SCAN_ENCODINGS = {
  /** Digits only, fixed widths — fits UPC-A/EAN/ITF labels. */
  FIXED: 'fixed',
  /** Delimiter-separated text — Code 128 / QR / DataMatrix labels. */
  DELIMITED: 'delimited',
} as const;
export type ScanEncoding = (typeof SCAN_ENCODINGS)[keyof typeof SCAN_ENCODINGS];

export const SCAN_SCHEME_KINDS = {
  /** The ECA model: the target resolves against escalations; the rule's steps run. */
  ACTION: 'action',
  /**
   * A badge: the target resolves against users (target_facet names the
   * lt_users.metadata key it matches) and a match mints a short-lived
   * acting-identity grant. Identity schemes never walk steps.
   */
  IDENTITY: 'identity',
} as const;
export type ScanSchemeKind = (typeof SCAN_SCHEME_KINDS)[keyof typeof SCAN_SCHEME_KINDS];

export const SCAN_VERBS = {
  SHOW_DETAIL: 'show-detail',
  SHOW_LIST: 'show-list',
  CLAIM: 'claim',
  CLAIM_SHOW_DETAIL: 'claim-show-detail',
  RELEASE: 'release',
  RESOLVE: 'resolve',
  ESCALATE: 'escalate',
  CANCEL: 'cancel',
  /** Locate the row, then PRESENT its reality + the step's labeled choices. */
  PRESENT: 'present',
} as const;
export type ScanVerb = (typeof SCAN_VERBS)[keyof typeof SCAN_VERBS];

/** Verbs that change escalation state (may carry a confirm prompt). */
export const SCAN_MUTATING_VERBS: readonly ScanVerb[] = [
  SCAN_VERBS.CLAIM,
  SCAN_VERBS.CLAIM_SHOW_DETAIL,
  SCAN_VERBS.RELEASE,
  SCAN_VERBS.RESOLVE,
  SCAN_VERBS.ESCALATE,
  SCAN_VERBS.CANCEL,
];

export const SCAN_OUTCOMES = {
  /** A step matched and its action ran (or the located item is returned for show verbs). */
  EXECUTED: 'executed',
  /** A show-list step matched multiple escalations. */
  MATCHED_LIST: 'matched_list',
  /** A confirm step located its target; the client must confirm before the per-id action runs. */
  CONFIRM_REQUIRED: 'confirm_required',
  /** No step matched; render the rule's fallback screen. */
  NO_MATCH_FALLBACK: 'no_match_fallback',
  /** Unknown/disabled scheme version or category. */
  UNCONFIGURED: 'unconfigured',
  /** The code string did not parse under the scheme. */
  INVALID_CODE: 'invalid_code',
  /** The caller's roles do not permit the matched action. */
  FORBIDDEN: 'forbidden',
  /** A concurrent actor won the row (double scan). */
  CONFLICT: 'conflict',
  /** An identity scan matched a user; the response carries the acting grant. */
  IDENTITY_PRIMED: 'identity_primed',
  /** An identity scan matched no user; render the rule's fallback screen. */
  IDENTITY_UNKNOWN: 'identity_unknown',
  /**
   * The step/choice requires an acting identity the request cannot satisfy
   * (no grant, a dead grant, or a write-incapable principal); render the
   * rule's notPrimed screen. Distinct from FORBIDDEN — the acting user's own
   * RBAC was never consulted.
   */
  NOT_PRIMED: 'not_primed',
  /** A PRESENT step located its row; the response carries reality + choices. */
  CHOICES: 'choices',
} as const;
export type ScanOutcome = (typeof SCAN_OUTCOMES)[keyof typeof SCAN_OUTCOMES];

export const SCAN_AVAILABILITY = {
  AVAILABLE: 'available',
  CLAIMED: 'claimed',
  MINE: 'mine',
  ANY: 'any',
} as const;
export type ScanAvailability = (typeof SCAN_AVAILABILITY)[keyof typeof SCAN_AVAILABILITY];

export const SCAN_CARDINALITY = {
  FIRST: 'first',
  MANY: 'many',
} as const;
export type ScanCardinality = (typeof SCAN_CARDINALITY)[keyof typeof SCAN_CARDINALITY];

/** Metadata keys stamped onto escalations touched by a scan (provenance). */
export const SCAN_PROVENANCE_KEYS = {
  SCHEME: 'scanScheme',
  CATEGORY: 'scanCategory',
  ACTION_NAME: 'scanActionName',
  SCANNED_AT: 'scannedAt',
  /** The authenticated device principal when a mutation ran under an acting identity. */
  STATION: 'scanStation',
} as const;

/** The ephemeral-keystore label acting-identity grants are minted under. */
export const ACTING_IDENTITY_LABEL = 'acting_identity';

/** Template tokens usable inside step params (resolver payload, metadata). */
export const SCAN_TEMPLATE_TOKENS = {
  TARGET: '{scan.target}',
  CATEGORY: '{scan.category}',
  SCANNED_AT: '{scan.scannedAt}',
} as const;

export interface ScanScheme {
  version: number;
  name: string;
  description: string | null;
  /**
   * The metadata key the scanned target resolves against: an escalation
   * metadata key for action schemes, an lt_users.metadata key (e.g.
   * badge_id) for identity schemes.
   */
  target_facet: string;
  encoding: ScanEncoding;
  delimiter: string;
  target_length: number | null;
  kind: ScanSchemeKind;
  /** Identity kind only: how long a minted acting grant lives (1–86400 s). */
  grant_ttl_seconds: number | null;
  /** Identity kind only: 0 = TTL-bound; n = the grant covers n scan requests. */
  grant_max_uses: number;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

/** The Condition: a view over the escalation surface. */
export interface ScanStepQuery {
  /** Expected queue(s). Empty/absent = any role visible to the caller. */
  roles?: string[];
  status?: 'pending' | 'resolved' | 'cancelled';
  availability?: ScanAvailability;
  /** Extra metadata guards beyond the scheme's target facet. */
  facets?: Record<string, any>;
}

export interface ScanStepParams {
  /** Canned resolver payload template (resolve). Values may use SCAN_TEMPLATE_TOKENS. */
  resolverPayload?: Record<string, any>;
  /** Metadata to merge/stamp (claim, resolve, escalate). */
  metadata?: Record<string, any>;
  /** Target role for escalate (a new escalation is created there). */
  targetRole?: string;
  /** Escalation type for the created escalation (escalate). */
  escalationType?: string;
  /** Description for the created escalation (escalate). */
  description?: string;
  /** How to close the located escalation before an escalate creates the next one. */
  closeCurrent?: 'resolve' | 'cancel';
  /** Claim window (claim verbs). */
  durationMinutes?: number;
}

export interface ScanStep {
  query: ScanStepQuery;
  cardinality?: ScanCardinality;
  verb: ScanVerb;
  /** Present = two-phase: locate, then the client confirms before the per-id action runs. */
  confirm?: { prompt: string };
  params?: ScanStepParams;
  /** PRESENT only: the labeled choice set rendered under the located reality. */
  choices?: ScanChoice[];
  /**
   * PRESENT only: when the step holds exactly ONE confirm-less choice, the
   * scan executes it directly instead of presenting — one scan, one action.
   * An unsatisfied identity requirement still stops over at the badge screen.
   */
  autoSelectSingle?: boolean;
  /** The step executes only under a real acting identity (badge or a write-capable login). */
  requireActingIdentity?: boolean;
}

export interface ScanRuleFallback {
  /** Markdown rendered on the fallback screen when no step matches. */
  markdown?: string;
  /** Optional dashboard route to land on instead of the default list. */
  route?: string;
}

export interface ScanRule {
  scheme_version: number;
  /** Single digit, '0'–'9' (auto-assigned). */
  category: string;
  /** Friendly label — this is what gets printed next to the physical code. */
  name: string;
  steps: ScanStep[];
  fallback: ScanRuleFallback;
  /** The "scan your badge" screen — rendered when an acting identity is required and absent. */
  notPrimed: ScanRuleFallback;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ParsedScanCode {
  version: number;
  category: string;
  target: string;
}

export interface ScanExecuteRequest {
  code: string;
  /** An acting-identity grant (eph:v1:acting_identity:*) — verbs run as that user. */
  actingToken?: string;
  /** The grant being replaced by an identity scan — best-effort revoked on mint. */
  previousActingToken?: string;
}


/** Action awaiting client-side confirmation (CONFIRM_REQUIRED). */
export interface ScanPendingAction {
  escalationId: string;
  verb: ScanVerb;
  prompt: string;
  params?: ScanStepParams;
}

export interface ScanExecuteResponse {
  outcome: ScanOutcome;
  /** The parsed code, echoed for display/toasts. */
  parsed?: ParsedScanCode;
  /** Rule identity (name is the friendly label). */
  rule?: { schemeVersion: number; category: string; name: string };
  /** Index of the step that matched. */
  stepIndex?: number;
  verb?: ScanVerb;
  /** Single matched escalation (show-detail, claim, resolve, escalate, cancel outcomes). */
  escalation?: Record<string, any>;
  /** Multiple matches (show-list). */
  escalations?: Record<string, any>[];
  total?: number;
  /** Query the client uses to build the list-page URL (show-list). */
  listQuery?: ScanStepQuery & { targetFacet: string; target: string };
  pendingAction?: ScanPendingAction;
  fallback?: ScanRuleFallback;
  /** The "scan your badge" screen (NOT_PRIMED, or beside withheld choices). */
  notPrimed?: ScanRuleFallback;
  /** The labeled choice set (CHOICES). */
  choices?: ScanPresentedChoice[];
  /** CHOICES: the step would auto-execute its single choice — only identity stopped it. */
  autoSelect?: boolean;
  /** The badged person (IDENTITY_PRIMED) — id lets the client recognize its own claims. */
  actor?: { id: string; displayName: string };
  /** The minted acting grant (IDENTITY_PRIMED) — eph:v1:acting_identity:<uuid>. */
  actingToken?: string;
  /** Display copy of the grant's expiry (the keystore enforces it). */
  expiresAt?: string;
  error?: string;
}
