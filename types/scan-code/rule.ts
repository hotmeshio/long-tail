import type { ContainerSelector } from '../facets';
import type { SchemeIdentifier } from '../identifiers';
import type { ScanChoice } from '../scan-choice';
import type {
  ScanAvailability,
  ScanCardinality,
  ScanEncoding,
  ScanFactFormat,
  ScanGrantScope,
  ScanSchemeKind,
  ScanTargetMatch,
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
  /**
   * Fixed encoding: the target's digit count. Delimited identity schemes:
   * the length of a generated badge (8 to 64, default 10); scans of any
   * length still resolve.
   */
  target_length: number | null;
  /** Pattern encoding only: regular expressions over the whole code. */
  patterns: string[];
  /**
   * Pattern encoding only: which reads a digits-only code first beside an
   * enabled gtin scheme (true, these patterns; false, the gtin scheme).
   * Null until declared; required while an enabled gtin scheme exists.
   */
  precedes_gtin: boolean | null;
  /** How the target matches the target facet: one value, or a member of a list. */
  target_match: ScanTargetMatch;
  kind: ScanSchemeKind;
  /** Identity kind only: how long a minted acting grant lives (1–86400 s). */
  grant_ttl_seconds: number | null;
  /** Identity kind only: 0 = TTL-bound; n = the grant covers n acts. */
  grant_max_uses: number;
  /** Identity kind only: how the grant is spent (default 'action'). */
  grant_scope: ScanGrantScope;
  /** Binding settings: who may bind this scheme's values, and whether a target holds one live value. */
  identifier?: SchemeIdentifier | null;
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
  /**
   * Escalation types / subtypes the located row must have. Steps that locate
   * and then act by id only (show, list, present with any choice, hold, fill,
   * accumulate); with `availability: 'mine'`, at most one of each.
   */
  types?: string[];
  subtypes?: string[];
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
  bind?: ScanBindParams;
}

/** A bind step: the scanned value is bound to the held subject's target. */
export interface ScanBindParams {
  /** The scheme the binding is kept under; the scanned code's own scheme by default. */
  scheme?: number;
  /** The subject's facet the value is bound to; its scheme's target facet by default. */
  facet?: string;
  /** A value bound elsewhere moves here (its old binding retired), instead of being refused. */
  move?: boolean;
  /** Once bound, resolve the held row with this payload (scan templates allowed) and release it. */
  resolve?: { payload?: Record<string, unknown> };
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
  /**
   * Into-subject mode: the scanned code's own pending row (the scheme's
   * target facet = the scanned target, narrowed by this selector and the
   * actor's read scope) is written as the reciprocal in the same statement
   * as the subject's entry. Absent, nothing else is written.
   */
  item?: ContainerSelector & { roles?: string[] };
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
  /**
   * A roster field of the held row's form, shown under the hold card while
   * the row is held: each fill ticks its entry in without leaving the motion.
   */
  show?: string;
  /** The button that ends the hold. Absent, it reads "Put it down" and the station stays. */
  release?: ScanHoldRelease;
  /**
   * With `show`: once every entry on the roster is in, the hold ends on its
   * own with this done copy, then the station returns as after a completed act.
   */
  whenAllIn?: ScanDoneCopy;
}

export interface ScanHoldRelease {
  /** Default "Put it down". */
  label?: string;
  /** 'accent' draws the button as the screen's primary act. Default 'neutral'. */
  tone?: 'neutral' | 'accent';
  /** Where the station goes once released: the kiosk home or a dashboard route. Absent, it stays. */
  return?: 'home' | string;
}

export interface ScanFillParams {
  /** Which row holds the batch: the held subject, or the row the scan names. */
  into: 'subject' | 'scanned';
  /** Batch keys are `<code><separator><n>`; a scan fills the first open key for its code. */
  separator?: string;
  /** Batch resolver payload (template). Default `{ scannedCode: '{scan.code}' }`. */
  payload?: Record<string, any>;
  /**
   * A per-key map on the batch row naming each entry (`envelope.shoe_labels`).
   * With it, `{fill.pending}` lists the open entries by label, `{fill.next}`
   * names the next one, and a refusal's expected list reads the labels.
   */
  labels?: string;
  /**
   * How one entry reads: `{label.<path>}` reads the entry's map value and
   * `{code}` its printed code. Absent, a text map value is the label. An
   * entry the map does not name reads as its code.
   */
  label?: string;
  /**
   * Into-subject only: a per-key map on the batch row (`envelope.<map>`)
   * naming the value each key belongs to. Open keys whose value equals (or,
   * for a list, contains) the held subject's target fill first; the rest
   * follow in the row's order.
   */
  prefer?: string;
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
  /** The located row (the item's own row on an into-subject add, else the container) must share each of these facets with the subject. */
  facets?: string[];
}

/** What the station says when a step refuses. Markdown templates. */
export interface ScanRefusal {
  /** A failed match. */
  markdown: string;
  /** The atomic write lost a race (the container closed, the slot was taken). */
  conflict?: string;
  /**
   * Subject accumulate: the pairing held but the row the scan names was not
   * found (the open container for from-subject, the item's own row for
   * into-subject with `item`). Without it the step falls through.
   */
  missing?: string;
}

/** What the station says once a write lands, and how long it stays. */
export interface ScanDoneCopy {
  /** Markdown template. */
  markdown: string;
  /** Seconds before the station returns; overrides the role's `scan_done.after_seconds` for this act. */
  afterSeconds?: number;
  /** The line under the copy, in place of "Scan the next item". Markdown template. */
  nextPrompt?: string;
}

/** The row an Open button leads to. */
export type ScanOpenTarget = 'row' | 'subject' | 'located';

/**
 * An Open button on the station's answer (hold, done, refusal): the row's
 * detail page, or the list of rows sharing facets with it.
 */
export interface ScanOpen {
  /** Default "Open". */
  label?: string;
  /**
   * `row`: the row the step acted on or located. `subject`: the held row.
   * `located`: the scanned code's own pending row.
   */
  target: ScanOpenTarget;
  /** Open the list of rows sharing these facets with the target, in place of the row. */
  list?: { facets: string[]; role?: string };
  /** Claim the row for the person acting when their scope covers it; otherwise it opens read-only. */
  claim?: boolean;
}

/** One labeled fact on the info-choice screen. */
export interface ScanFact {
  label: string;
  /** Template rendered against the located row (`{item.<facet>}`) and the scan tokens. */
  value: string;
  /**
   * Render the value as a list column does (`date`, `age`, `ago`); the value
   * must then be a single token, so the station receives the raw value.
   */
  format?: ScanFactFormat;
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
   * PRESENT only: the facts the station states about the located row, in
   * order. Each value is a template (`{item.binCode}`, `{scan.target}`); a
   * token with nothing to read renders empty. Absent, the station lists the
   * row's metadata.
   */
  facts?: ScanFact[];
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
  done?: ScanDoneCopy;
  /** An Open button on the hold, done or refusal screen this step answers with. */
  open?: ScanOpen;
  /**
   * PRESENT only: a roster field of the row's form, shown above the choices
   * as a hold shows it.
   */
  show?: string;
  /**
   * After this write completes the held subject, the station follows the
   * subject to its next pending row in these roles: it waits for the row,
   * replays the held code, and holds the new row. The wait ends on the done
   * copy when no row appears in `waitSeconds` (default 10).
   */
  follow?: ScanFollow;
}

export interface ScanFollow {
  roles: string[];
  waitSeconds?: number;
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
