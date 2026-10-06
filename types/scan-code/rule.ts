import type { ContainerSelector } from '../facets';
import type { ScanChoice } from '../scan-choice';
import type {
  ScanAvailability,
  ScanCardinality,
  ScanEncoding,
  ScanGrantScope,
  ScanSchemeKind,
  ScanVerb,
} from './constants';

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
  /** Identity kind only: 0 = TTL-bound; n = the grant covers n acts. */
  grant_max_uses: number;
  /** Identity kind only: how the grant is spent (default 'action'). */
  grant_scope: ScanGrantScope;
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
  /** Canned resolver payload template (resolve, accumulate). Values may use template tokens. */
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
  /** Item key template (accumulate). Defaults to `{scan.target}` where one is implied. */
  itemKey?: string;
  /** Accumulate verb options. */
  accumulate?: ScanAccumulateParams;
  /** Hold verb options. */
  hold?: ScanHoldParams;
  /** Fill verb options. */
  fill?: ScanFillParams;
}

export interface ScanAccumulateParams {
  /**
   * Item-locate mode: the scanned target is the item's own escalation (found
   * by the scheme facet); the container is the pending accumulator whose
   * metadata carries this facet with the same value the item row holds.
   */
  containerFacet?: string;
  /** Expected container queue(s); intersects with the actor's write scope. Alias of `container.roles`. */
  containerRoles?: string[];
  /**
   * Which pending accumulator may be the container: types, subtypes and
   * extra facet guards narrow the pick. Item mode and subject mode only.
   */
  container?: ContainerSelector & { roles?: string[] };
  /** Item-locate mode: also write the item's row as the reciprocal (default true). */
  reciprocal?: boolean;
  /**
   * Subject mode: the held subject is the item and the scanned code names
   * the container. The subject's row is written as the reciprocal, so a
   * one-slot subject completes in the same statement.
   */
  from?: 'subject';
  /** Into-subject mode: the held subject's row is the accumulator; the item is the scanned code. */
  into?: 'subject';
}

export interface ScanHoldParams {
  /** Seconds the station holds the subject (5..600, default 45). */
  ttlSeconds?: number;
  /** What the station calls the subject. Template; default `{scan.target}`. */
  label?: string;
  /**
   * Where the item goes, shown largest on the station (e.g. `{item.containerCode}`).
   * Template; absent, the label leads.
   */
  headline?: string;
  /** The line under the headline (e.g. `{item.locationName}`). Template. */
  subline?: string;
  /** The scan the station expects next, and the words that ask for it. */
  expect?: { schemes: number[]; prompt?: string };
}

export interface ScanFillParams {
  /** Which row holds the batch: the held subject, or the row the scan names. */
  into: 'subject' | 'scanned';
  /** Batch keys are `<code><separator><n>`; a scan fills the first open key for its code. */
  separator?: string;
  /** Batch resolver payload (template). Default `{ scannedCode: '{scan.code}' }`. */
  payload?: Record<string, any>;
}

/** A step that acts on the held subject runs only while one is held. */
export interface ScanSubjectGate {
  /** Scheme versions the subject must have been scanned under. */
  schemes: number[];
  /** A live claim on the subject by someone other than the actor. Default 'refuse'. */
  claimedByOther?: 'refuse' | 'allow';
  /**
   * The held row must carry these facet values, or the step is skipped (the
   * scan falls through to the next step). Branches one rule by the held
   * item's state, e.g. `{ placement: 'unassigned' }`.
   */
  facets?: Record<string, string | number | boolean>;
}

/** The pre-write guard: a failed match refuses with nothing written. */
export interface ScanMatch {
  /** The scanned target must equal one of these (templates). */
  target?: string[];
  /** The located container must share each of these facets with the subject. */
  facets?: string[];
}

/** What the station says when a step refuses. Markdown templates. */
export interface ScanRefusal {
  /** A failed match. */
  markdown: string;
  /** The atomic write lost a race (the container closed, the slot was taken). */
  conflict?: string;
  /**
   * From-subject accumulate: the pairing held but no open container carries
   * the scanned code. Without it the step falls through to the next one.
   */
  missing?: string;
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
  /** The step acts on the held subject and is skipped while none is held. */
  subject?: ScanSubjectGate;
  /** Checked before the write; a miss refuses. */
  match?: ScanMatch;
  /** Refusal copy for a failed match or a lost race. */
  refuse?: ScanRefusal;
  /**
   * What the station says once the step's write lands: "Place it in
   * **{container.containerCode}**." Markdown template; it may read the bags its
   * refusal copy may read.
   */
  done?: { markdown: string };
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
