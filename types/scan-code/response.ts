import type { ScanPresentedChoice } from '../scan-choice';
import type { ScanOutcome, ScanVerb } from './constants';
import type { ScanRuleFallback, ScanStepParams, ScanStepQuery } from './rule';

export interface ParsedScanCode {
  version: number;
  category: string;
  target: string;
  /** The code as scanned, when the target was normalized from it (GTIN). */
  raw?: string;
}

/**
 * The station's pointer to the item it is holding. The client sends it
 * back with each scan; the server re-derives everything from it and trusts
 * nothing else about it.
 */
export interface ScanSubjectRef {
  /** The raw code that established the subject (e.g. "11:0:K7Q2M9XA"). */
  code: string;
  /** The row the hold resolved to. */
  escalationId: string;
}

/** A subject as the station shows it (HELD, and echoed while a fill continues). */
export interface ScanHeldSubject extends ScanSubjectRef {
  /** What the station calls it. */
  label: string;
  /** Where it goes, shown largest. */
  headline?: string;
  /** The line under the headline. */
  subline?: string;
  /** When the station lets it lapse (display and client timer). */
  expiresAt: string;
  /** The scan the station expects next. `prompt` is rendered markdown. */
  expect?: { schemes: number[]; prompt?: string };
  /** Someone else holds a live claim on the row. */
  claimedBy?: { id: string; displayName: string };
}

export interface ScanExecuteRequest {
  code: string;
  /** An acting-identity grant (eph:v1:acting_identity:*) — verbs run as that user. */
  actingToken?: string;
  /** The grant being replaced by an identity scan — best-effort revoked on mint. */
  previousActingToken?: string;
  /** The subject the station is holding. */
  subject?: ScanSubjectRef;
  /** The role the device is locked to; picks the badge policy when it holds several. */
  stationRole?: string;
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
  /** NO_OPEN_CONTAINER: the facet the located item names and no pending container carries. */
  container?: { facet: string; value: string };
  /** CHOICES: the step would auto-execute its single choice — only identity stopped it. */
  autoSelect?: boolean;
  /** The badged person (IDENTITY_PRIMED) — id lets the client recognize its own claims. */
  actor?: { id: string; displayName: string };
  /** The minted acting grant (IDENTITY_PRIMED) — eph:v1:acting_identity:<uuid>. */
  actingToken?: string;
  /** Display copy of the grant's expiry (the keystore enforces it). */
  expiresAt?: string;
  /** IDENTITY_PRIMED: the scheme's `grant_max_uses` (0 = TTL-bound). */
  maxUses?: number;
  /** IDENTITY_PRIMED: the scheme's grant scope. */
  grantScope?: 'action' | 'subject';
  /** What happened to the acting grant on this request. Present when one rode it. */
  acting?: { consumed: boolean; remaining: number | null; bound: boolean };
  /** HELD, and a fill that continues: the subject the station holds now. */
  subject?: ScanHeldSubject;
  /** The station drops its held subject. */
  clearSubject?: boolean;
  /** REFUSED: what to say, and the target(s) the step expected. */
  refusal?: { markdown: string; expected?: string[] };
  /** A fill: how far the batch has come. */
  progress?: { filled: number; total: number; remaining: number };
  /** An executed add that found the item already in place. */
  already?: boolean;
  /** EXECUTED: the step's `done` copy, rendered. */
  done?: { markdown: string };
  /** NOT_PRIMED that the client may replay once a badge primes. */
  replayable?: boolean;
  error?: string;
}
